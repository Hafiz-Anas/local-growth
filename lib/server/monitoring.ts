import "server-only";
import { after } from "next/server";
import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import {
  DURATION_MS,
  INTERVAL_MS,
  extendedEnd,
  intervalFor,
  monitorOutcome,
  monitorSeries,
  notableChange,
  sparkline,
  withAlert,
  type DailyRow,
  type MonitorAlerts,
  type MonitorBaseline,
  type MonitorDuration,
  type MonitorOutcome,
  type MonitorPoint,
  type Reading,
} from "@/lib/analysis/monitoring";
import { interactions, type AnalysisPost } from "@/lib/analysis/posts";
import { isFeatureEnabled, permissionsFromRows } from "@/lib/permissions";
import { getAIService } from "@/lib/services/ai";
import { InstagramNotConnectedError, InstagramPermissionError, InstagramRateLimitedError, getInstagramService, type InstagramAccount } from "@/lib/services/instagram";
import { monitorDataBlock } from "@/lib/services/text/monitoring";
import type { AiTextState, MonitorDetailDto, MonitorItemDto, MonitorPostDto, MonitorStatus, MonitorSummaryText, MonitoringDto, PlanId } from "@/types";
import { logActivity } from "./activity";
import { aiPace } from "./ai-pace";
import { ApiError, notFound } from "./http";
import { getInstagramAccount } from "./instagram-account";
import { coolingDown } from "./meta-client";
import { notify } from "./notifications";
import { ownPosts } from "./post-data";
import { MONITOR_ACTION_LIMIT, MONITOR_SUMMARY_LIMIT, getRateLimiter } from "./rate-limit";
import { getPlanLimits } from "./settings";

/**
 * "Monitor this post" (feature "monitoring"). A monitor reads one post's numbers until its end:
 * every hour for up to 3 days (MonitorSnapshot), once a day for longer (PostSnapshot, the same
 * daily rows Post performance uses — a reading already taken today is reused, not fetched again).
 * Readings run from GET /api/cron/monitor (hourly, external scheduler) and the daily cron.
 * A reading far above (or, after a day, far below) the account's average sends one notification
 * per level; at the end the numbers are computed in code and the AI writes a short summary of
 * them (numbers only when it can't). Instagram's limits: at most the plan's number of posts at
 * once (default 5), two Graph calls per reading, and nothing while Meta asks us to slow down.
 */

const HOUR = 60 * 60 * 1000;
/** Ended monitors shown in the history. */
const HISTORY_LIMIT = 30;
/** Monitors read per cron run (each reading is up to two Instagram calls). */
const CRON_BATCH = () => Math.max(1, Number(process.env.MONITOR_CRON_BATCH) || 100);
/** Posts the account's average is taken from. */
const BASELINE_POSTS = 20;

const STATUS: Record<"ACTIVE" | "ENDED" | "STOPPED" | "UNAVAILABLE", MonitorStatus> = { ACTIVE: "active", ENDED: "ended", STOPPED: "stopped", UNAVAILABLE: "unavailable" };

const MONITOR_SELECT = {
  id: true,
  businessId: true,
  igMediaId: true,
  post: true,
  duration: true,
  interval: true,
  status: true,
  startedAt: true,
  endsAt: true,
  endedAt: true,
  nextReadingAt: true,
  lastReadingAt: true,
  lastError: true,
  alerts: true,
  baseline: true,
  outcome: true,
  summary: true,
  summaryStatus: true,
} as const;
type MonitorRow = Prisma.PostMonitorGetPayload<{ select: typeof MONITOR_SELECT }>;

const today = () => new Date().toISOString().slice(0, 10);
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Posts the business's plan can monitor at the same time (System page → plan limits; default 5). */
export async function monitorLimit(businessId: string): Promise<number> {
  const [business, limits] = await Promise.all([db.business.findUniqueOrThrow({ where: { id: businessId }, select: { plan: true } }), getPlanLimits()]);
  return limits[business.plan.toLowerCase() as PlanId].monitoredPosts;
}

/** The account's averages over its other recent posts. */
export function baselineFrom(posts: AnalysisPost[], igMediaId: string): MonitorBaseline {
  const others = posts.filter((p) => p.id !== igMediaId).slice(0, BASELINE_POSTS);
  const reached = others.filter((p) => p.reach !== null && p.reach > 0);
  return {
    avgInteractions: others.length ? round1(others.reduce((n, p) => n + interactions(p), 0) / others.length) : null,
    avgReach: reached.length ? Math.round(reached.reduce((n, p) => n + p.reach!, 0) / reached.length) : null,
    basedOn: others.length,
  };
}

// ─── Reading the series ──────────────────────────────────────────────────────

async function seriesFor(rows: MonitorRow[]): Promise<Map<string, MonitorPoint[]>> {
  if (!rows.length) return new Map();
  const [hourly, daily] = await Promise.all([
    db.monitorSnapshot.findMany({ where: { monitorId: { in: rows.map((r) => r.id) } }, orderBy: { takenAt: "asc" } }),
    db.postSnapshot.findMany({
      where: { businessId: rows[0].businessId, igMediaId: { in: [...new Set(rows.map((r) => r.igMediaId))] } },
      orderBy: { date: "asc" },
      select: { igMediaId: true, date: true, takenAt: true, likes: true, comments: true, reach: true, saves: true, shares: true, views: true },
    }),
  ]);
  const result = new Map<string, MonitorPoint[]>();
  for (const row of rows) {
    const readings: Reading[] = hourly
      .filter((h) => h.monitorId === row.id)
      .map((h) => ({ at: h.takenAt.toISOString(), likes: h.likes, comments: h.comments, reach: h.reach, saves: h.saves, shares: h.shares, views: h.views }));
    const days: DailyRow[] = daily
      .filter((d) => d.igMediaId === row.igMediaId && d.takenAt >= new Date(row.startedAt.getTime() - HOUR))
      .map((d) => ({ date: d.date, takenAt: d.takenAt.toISOString(), likes: d.likes, comments: d.comments, reach: d.reach, saves: d.saves, shares: d.shares, views: d.views }));
    const until = (row.endedAt ?? new Date()).toISOString();
    result.set(row.id, monitorSeries(readings, days, row.startedAt.toISOString(), until));
  }
  return result;
}

const postOf = (row: MonitorRow, media?: { mediaUrl: string | null; permalink?: string | null }): MonitorPostDto => {
  const stored = row.post as Partial<MonitorPostDto>;
  return {
    caption: stored.caption ?? "",
    format: stored.format ?? "photo",
    postedAt: stored.postedAt ?? row.startedAt.toISOString(),
    // Meta's image URLs expire: use the synced one while the post is still among the recent posts.
    mediaUrl: media?.mediaUrl ?? stored.mediaUrl ?? null,
    permalink: media?.permalink ?? stored.permalink ?? null,
  };
};

function toItem(row: MonitorRow, points: MonitorPoint[], media?: { mediaUrl: string | null; permalink?: string | null }): MonitorItemDto {
  const latest = points.at(-1) ?? null;
  const baseline = row.baseline as unknown as MonitorBaseline;
  const average = baseline?.avgInteractions ?? null;
  return {
    id: row.id,
    igMediaId: row.igMediaId,
    post: postOf(row, media),
    status: STATUS[row.status],
    duration: row.duration as MonitorDuration,
    interval: row.interval === "HOURLY" ? "hourly" : "daily",
    startedAt: row.startedAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    lastReadingAt: row.lastReadingAt?.toISOString() ?? null,
    lastError: row.lastError,
    latest,
    readings: points.length,
    spark: sparkline(points),
    vsAveragePct: latest && average && average > 0 ? Math.round(((latest.interactions - average) / average) * 100) : null,
    summary: (row.summary as MonitorSummaryText | null) ?? null,
  };
}

export async function monitoringOverview(businessId: string): Promise<MonitoringDto> {
  const [own, limit, active, history] = await Promise.all([
    ownPosts(businessId),
    monitorLimit(businessId),
    db.postMonitor.findMany({ where: { businessId, status: "ACTIVE" }, orderBy: { endsAt: "asc" }, select: MONITOR_SELECT }),
    db.postMonitor.findMany({ where: { businessId, status: { not: "ACTIVE" } }, orderBy: { endedAt: "desc" }, take: HISTORY_LIMIT, select: MONITOR_SELECT }),
  ]);
  const series = await seriesFor([...active, ...history]);
  const item = (row: MonitorRow) => toItem(row, series.get(row.id) ?? [], own.media.get(row.igMediaId));
  const posts = own.posts.slice(0, 12).map((p) => ({ id: p.id, caption: p.caption, format: p.format, postedAt: p.postedAt, mediaUrl: own.media.get(p.id)?.mediaUrl ?? null }));
  return { connected: own.connected, demo: own.demo, limit, active: active.map(item), history: history.map(item), posts };
}

function summaryState(row: MonitorRow): AiTextState<MonitorSummaryText> {
  if (row.summary) return { status: "ready", text: row.summary as unknown as MonitorSummaryText, generatedAt: row.endedAt?.toISOString() ?? null, reason: null };
  // Not ended yet, or the AI couldn't write it last time: the page asks again (once per visit, rate limited).
  if (!row.outcome) return { status: "unavailable", text: null, generatedAt: null, reason: "not_ended" };
  return { status: "none", text: null, generatedAt: null, reason: null };
}

export async function monitorDetail(businessId: string, id: string): Promise<MonitorDetailDto> {
  const row = await db.postMonitor.findFirst({ where: { id, businessId }, select: MONITOR_SELECT });
  if (!row) throw notFound("Monitor");
  const [series, own] = await Promise.all([seriesFor([row]), ownPosts(businessId)]);
  const points = series.get(row.id) ?? [];
  return {
    ...toItem(row, points, own.media.get(row.igMediaId)),
    points,
    baseline: row.baseline as unknown as MonitorBaseline,
    alerts: row.alerts as MonitorAlerts,
    outcome: (row.outcome as unknown as MonitorOutcome | null) ?? null,
    summaryState: summaryState(row),
    demo: own.demo,
  };
}

// ─── Start, extend, stop ─────────────────────────────────────────────────────

async function consumeAction(businessId: string) {
  if (!(await getRateLimiter().consume(MONITOR_ACTION_LIMIT, businessId))) {
    throw new ApiError(429, "rate_limited", "Too many monitoring changes in the last hour. Try again later.");
  }
}

export async function startMonitor(ctx: { businessId: string; userId: string | null }, igMediaId: string, duration: MonitorDuration): Promise<MonitorItemDto> {
  const { businessId } = ctx;
  await consumeAction(businessId);
  const own = await ownPosts(businessId);
  if (!own.connected) throw new ApiError(409, "instagram_not_connected", "Connect Instagram to monitor a post.");
  const post = own.posts.find((p) => p.id === igMediaId);
  if (!post) throw notFound("Post");

  const [existing, activeCount, max] = await Promise.all([
    db.postMonitor.count({ where: { businessId, igMediaId, status: "ACTIVE" } }),
    db.postMonitor.count({ where: { businessId, status: "ACTIVE" } }),
    monitorLimit(businessId),
  ]);
  if (existing) throw new ApiError(409, "monitor_exists", "This post is already being monitored.");
  if (activeCount >= max) throw new ApiError(409, "monitor_limit", `Your plan monitors up to ${max} posts at a time.`, [{ path: "max", message: String(max) }]);

  const now = new Date();
  const media = own.media.get(igMediaId);
  const postData: MonitorPostDto = { caption: post.caption, format: post.format, postedAt: post.postedAt, mediaUrl: media?.mediaUrl ?? null, permalink: media?.permalink ?? null };
  const row = await db.postMonitor.create({
    data: {
      businessId,
      igMediaId,
      post: postData as unknown as Prisma.InputJsonObject,
      duration,
      interval: intervalFor(DURATION_MS[duration]) === "hourly" ? "HOURLY" : "DAILY",
      startedAt: now,
      endsAt: new Date(now.getTime() + DURATION_MS[duration]),
      nextReadingAt: now,
      baseline: baselineFrom(own.posts, igMediaId) as unknown as Prisma.InputJsonObject,
      startedBy: ctx.userId,
    },
    select: MONITOR_SELECT,
  });
  await logActivity({ businessId, userId: ctx.userId, action: "monitoring.started", details: { igMediaId, duration } });
  // The first reading now, so the chart starts at the moment monitoring did.
  const read = await readMonitor(row).catch(() => null);
  const fresh = read ?? row;
  return toItem(fresh, (await seriesFor([fresh])).get(fresh.id) ?? [], media);
}

async function ownActive(businessId: string, id: string): Promise<MonitorRow> {
  const row = await db.postMonitor.findFirst({ where: { id, businessId }, select: MONITOR_SELECT });
  if (!row) throw notFound("Monitor");
  if (row.status !== "ACTIVE") throw new ApiError(409, "conflict", "Monitoring of this post has already ended.");
  return row;
}

export async function extendMonitor(ctx: { businessId: string; userId: string | null }, id: string, duration: MonitorDuration): Promise<MonitorItemDto> {
  await consumeAction(ctx.businessId);
  const row = await ownActive(ctx.businessId, id);
  const endsAt = new Date(extendedEnd(row.endsAt.getTime(), duration));
  const interval = intervalFor(endsAt.getTime() - row.startedAt.getTime()) === "hourly" ? "HOURLY" : "DAILY";
  const updated = await db.postMonitor.update({ where: { id }, data: { endsAt, interval, duration }, select: MONITOR_SELECT });
  await logActivity({ businessId: ctx.businessId, userId: ctx.userId, action: "monitoring.extended", details: { igMediaId: row.igMediaId, duration, endsAt: endsAt.toISOString() } });
  return toItem(updated, (await seriesFor([updated])).get(id) ?? []);
}

export async function stopMonitor(ctx: { businessId: string; userId: string | null }, id: string): Promise<MonitorItemDto> {
  await consumeAction(ctx.businessId);
  const row = await ownActive(ctx.businessId, id);
  const finished = await finishMonitor(row, "STOPPED");
  await logActivity({ businessId: ctx.businessId, userId: ctx.userId, action: "monitoring.stopped", details: { igMediaId: row.igMediaId } });
  // The AI summary doesn't hold up the answer.
  after(() => summarizeAndNotify(finished.id).catch((e) => console.error("[monitoring] summary failed", (e as Error).message)));
  return toItem(finished, (await seriesFor([finished])).get(id) ?? []);
}

// ─── Readings ────────────────────────────────────────────────────────────────

type ReadingResult = MonitorRow | null;

function readingErrorCode(error: unknown): string {
  if (error instanceof InstagramNotConnectedError) return "not_connected";
  if (error instanceof InstagramRateLimitedError) return "rate_limited";
  if (error instanceof InstagramPermissionError) return "permission";
  return "failed";
}

/**
 * Reads one monitored post now: from today's daily snapshot when it is a daily monitor and one was
 * already taken (no Instagram call), otherwise from Instagram. Stores the reading, sends a
 * notable-change alert when there is one, and ends the monitor if the post no longer exists.
 * Returns the updated row (null when skipped because Meta asked us to slow down).
 */
export async function readMonitor(row: MonitorRow, account?: InstagramAccount): Promise<ReadingResult> {
  const { businessId, igMediaId } = row;
  const now = new Date();
  const date = today();
  let reading: Reading | null = null;

  if (row.interval === "DAILY") {
    const snap = await db.postSnapshot.findUnique({ where: { businessId_igMediaId_date: { businessId, igMediaId, date } } });
    if (snap && snap.takenAt >= row.startedAt) reading = { at: snap.takenAt.toISOString(), likes: snap.likes, comments: snap.comments, reach: snap.reach, saves: snap.saves, shares: snap.shares, views: snap.views };
  }

  if (!reading) {
    const acct = account ?? (await getInstagramAccount(businessId));
    if (acct.provider === "meta" && coolingDown(businessId)) {
      await db.postMonitor.update({ where: { id: row.id }, data: { lastError: "rate_limited" } });
      return null;
    }
    let metrics;
    try {
      metrics = await getInstagramService().getPostMetrics(acct, igMediaId);
    } catch (error) {
      // Try again in an hour (daily monitors too, so a missed day is caught up).
      return db.postMonitor.update({ where: { id: row.id }, data: { lastError: readingErrorCode(error), nextReadingAt: new Date(now.getTime() + HOUR) }, select: MONITOR_SELECT });
    }
    if (!metrics) {
      const ended = await finishMonitor(row, "UNAVAILABLE");
      await summarizeAndNotify(ended.id);
      return ended;
    }
    reading = { at: now.toISOString(), ...metrics };
    const values = { likes: metrics.likes, comments: metrics.comments, reach: metrics.reach, saves: metrics.saves, shares: metrics.shares, views: metrics.views };
    await db.$transaction([
      ...(row.interval === "HOURLY" ? [db.monitorSnapshot.create({ data: { monitorId: row.id, takenAt: now, ...values } })] : []),
      // Today's daily row (Post performance's history) stays current too.
      db.postSnapshot.upsert({
        where: { businessId_igMediaId_date: { businessId, igMediaId, date } },
        create: { businessId, igMediaId, date, ...values, takenAt: now },
        update: { ...values, takenAt: now },
      }),
    ]);
  }

  const interval = row.interval === "HOURLY" ? "hourly" : "daily";
  let alerts = row.alerts as MonitorAlerts;
  const post = row.post as Partial<MonitorPostDto>;
  const change = notableChange(reading, row.baseline as unknown as MonitorBaseline, alerts, post.postedAt ?? row.startedAt.toISOString(), now.getTime());
  if (change) {
    alerts = withAlert(alerts, change);
    await notify({
      businessId,
      type: change.kind === "below" ? "monitor_below" : change.metric === "reach" ? "monitor_reach_above" : "monitor_above",
      params: { value: change.value, average: Math.round(change.average), pct: Math.abs(change.pct) },
      href: `/post-monitoring/${row.id}`,
    });
  }
  return db.postMonitor.update({
    where: { id: row.id },
    data: { lastReadingAt: now, lastError: null, nextReadingAt: new Date(now.getTime() + INTERVAL_MS[interval]), alerts: alerts as Prisma.InputJsonObject },
    select: MONITOR_SELECT,
  });
}

/** Ends a monitor: final numbers computed in code; the AI summary follows separately (summaryStatus "pending"). */
async function finishMonitor(row: MonitorRow, status: "ENDED" | "STOPPED" | "UNAVAILABLE"): Promise<MonitorRow> {
  const endedAt = new Date();
  const closed = { ...row, endedAt };
  const points = (await seriesFor([closed])).get(row.id) ?? [];
  const outcome = monitorOutcome(points, row.baseline as unknown as MonitorBaseline, row.startedAt.toISOString(), endedAt.toISOString());
  return db.postMonitor.update({
    where: { id: row.id },
    data: { status, endedAt, outcome: outcome as unknown as Prisma.InputJsonObject, summaryStatus: "pending" },
    select: MONITOR_SELECT,
  });
}

/**
 * The AI's short summary of an ended monitor's numbers (EN + AR). Any number not in the data
 * rejects the answer; when the AI can't write it the history shows the numbers only.
 */
async function summarize(row: MonitorRow): Promise<AiTextState<MonitorSummaryText>> {
  const outcome = row.outcome as unknown as MonitorOutcome | null;
  if (!outcome) return summaryState(row);
  const [business, account] = await Promise.all([db.business.findUniqueOrThrow({ where: { id: row.businessId }, select: { name: true, nameAr: true } }), getInstagramAccount(row.businessId)]);
  const post = postOf(row);
  const answer = await getAIService().monitorSummary({
    businessId: row.businessId,
    businessName: business.name,
    businessNameAr: business.nameAr,
    data: monitorDataBlock({ format: post.format, postedAt: post.postedAt, caption: post.caption, duration: row.duration, interval: row.interval === "HOURLY" ? "hourly" : "daily", demo: account.provider === "mock", outcome }),
  });
  if (!answer.ok) {
    await db.postMonitor.update({ where: { id: row.id }, data: { summaryStatus: "unavailable" } });
    return { status: "unavailable", text: null, generatedAt: null, reason: answer.reason };
  }
  const text = { en: answer.en, ar: answer.ar };
  await db.postMonitor.update({ where: { id: row.id }, data: { summary: text, summaryStatus: "ok" } });
  return { status: "ready", text, generatedAt: new Date().toISOString(), reason: null };
}

async function summarizeAndNotify(id: string) {
  const row = await db.postMonitor.findUniqueOrThrow({ where: { id }, select: MONITOR_SELECT });
  await summarize(row);
  await notify({ businessId: row.businessId, type: "monitor_ended", params: { duration: row.duration, status: STATUS[row.status] }, href: `/post-monitoring/${row.id}` });
}

/** POST /api/monitoring/:id/summary — the summary of an ended monitor, written again if the AI couldn't before. */
export async function requestSummary(businessId: string, id: string): Promise<AiTextState<MonitorSummaryText>> {
  const row = await db.postMonitor.findFirst({ where: { id, businessId }, select: MONITOR_SELECT });
  if (!row) throw notFound("Monitor");
  if (row.summary || !row.outcome) return summaryState(row);
  if (!(await getRateLimiter().consume(MONITOR_SUMMARY_LIMIT, businessId))) {
    throw new ApiError(429, "analysis_limit", "You've asked for many summaries in the last hour. The numbers are all here; try again later.");
  }
  return summarize(row);
}

// ─── The cron ────────────────────────────────────────────────────────────────

export interface MonitorSweepSummary {
  read: number;
  reused: number;
  ended: number;
  summarized: number;
  skipped: number;
  failed: number;
  stoppedEarly: boolean;
}

/**
 * GET /api/cron/monitor (hourly) and the daily cron: ends monitors whose time is up (a last reading,
 * the final numbers, the AI summary, a notification), then reads the monitors that are due.
 * Businesses with the feature off are left alone; stops starting new work at the deadline.
 */
export async function runMonitorSweep(deadlineMs: number): Promise<MonitorSweepSummary> {
  const started = Date.now();
  const summary: MonitorSweepSummary = { read: 0, reused: 0, ended: 0, summarized: 0, skipped: 0, failed: 0, stoppedEarly: false };
  const late = () => Date.now() - started > deadlineMs;
  const enabled = new Map<string, boolean>();
  const accounts = new Map<string, InstagramAccount>();
  const featureOn = async (businessId: string) => {
    if (!enabled.has(businessId)) {
      const rows = await db.featurePermission.findMany({ where: { businessId }, select: { featureKey: true, enabled: true } });
      enabled.set(businessId, isFeatureEnabled(permissionsFromRows(rows), "monitoring"));
    }
    return enabled.get(businessId)!;
  };
  const accountOf = async (businessId: string) => {
    if (!accounts.has(businessId)) accounts.set(businessId, await getInstagramAccount(businessId));
    return accounts.get(businessId)!;
  };
  let budget = CRON_BATCH();

  // 1. Monitors whose time is up.
  const due = await db.postMonitor.findMany({ where: { status: "ACTIVE", endsAt: { lte: new Date() } }, orderBy: { endsAt: "asc" }, take: 50, select: MONITOR_SELECT });
  for (const row of due) {
    if (late()) {
      summary.stoppedEarly = true;
      return summary;
    }
    try {
      if (!(await featureOn(row.businessId))) {
        summary.skipped += 1;
        continue;
      }
      let current = row;
      // A last reading unless one was taken in the last half hour.
      if (budget > 0 && (!row.lastReadingAt || Date.now() - row.lastReadingAt.getTime() > HOUR / 2)) {
        budget -= 1;
        current = (await readMonitor(row, await accountOf(row.businessId))) ?? row;
      }
      if (current.status === "ACTIVE") {
        await finishMonitor(current, "ENDED");
        summary.ended += 1;
        await aiPace();
        await summarizeAndNotify(current.id);
        summary.summarized += 1;
      }
    } catch (error) {
      summary.failed += 1;
      console.error("[monitoring] ending failed", row.id, (error as Error).message);
    }
  }

  // 2. Summaries that a stopped request didn't finish (e.g. the function was cut off).
  const pending = await db.postMonitor.findMany({ where: { status: { not: "ACTIVE" }, summaryStatus: "pending", endedAt: { lte: new Date(Date.now() - 10 * 60 * 1000) } }, take: 10, select: { id: true } });
  for (const { id } of pending) {
    if (late()) break;
    await aiPace();
    await summarizeAndNotify(id).catch(() => {});
    summary.summarized += 1;
  }

  // 3. Readings that are due.
  const reading = await db.postMonitor.findMany({ where: { status: "ACTIVE", endsAt: { gt: new Date() }, nextReadingAt: { lte: new Date() } }, orderBy: { nextReadingAt: "asc" }, take: budget, select: MONITOR_SELECT });
  for (const row of reading) {
    if (late()) {
      summary.stoppedEarly = true;
      break;
    }
    try {
      if (!(await featureOn(row.businessId))) {
        summary.skipped += 1;
        continue;
      }
      const reusedBefore = row.interval === "DAILY" && (await db.postSnapshot.count({ where: { businessId: row.businessId, igMediaId: row.igMediaId, date: today(), takenAt: { gte: row.startedAt } } })) > 0;
      const result = await readMonitor(row, await accountOf(row.businessId));
      if (!result) summary.skipped += 1;
      else if (result.lastError) summary.failed += 1;
      else if (reusedBefore) summary.reused += 1;
      else summary.read += 1;
    } catch (error) {
      summary.failed += 1;
      console.error("[monitoring] reading failed", row.id, (error as Error).message);
    }
  }
  return summary;
}

// ─── For the assistant ───────────────────────────────────────────────────────

export interface MonitoringFacts {
  active: Array<{ caption: string; postedAt: string; duration: string; startedAt: string; endsAt: string; readings: number; latest: MonitorPoint | null; first: MonitorPoint | null; vsAveragePct: number | null; average: number | null }>;
  ended: Array<{ caption: string; postedAt: string; duration: string; endedAt: string; outcome: MonitorOutcome | null }>;
}

/** Active and recently ended monitors, numbers only (no AI call). */
export async function monitoringFacts(businessId: string): Promise<MonitoringFacts> {
  const [active, ended] = await Promise.all([
    db.postMonitor.findMany({ where: { businessId, status: "ACTIVE" }, orderBy: { startedAt: "desc" }, take: 10, select: MONITOR_SELECT }),
    db.postMonitor.findMany({ where: { businessId, status: { not: "ACTIVE" } }, orderBy: { endedAt: "desc" }, take: 5, select: MONITOR_SELECT }),
  ]);
  const series = await seriesFor(active);
  return {
    active: active.map((row) => {
      const points = series.get(row.id) ?? [];
      const post = postOf(row);
      const average = (row.baseline as unknown as MonitorBaseline)?.avgInteractions ?? null;
      const latest = points.at(-1) ?? null;
      return {
        caption: post.caption,
        postedAt: post.postedAt,
        duration: row.duration,
        startedAt: row.startedAt.toISOString(),
        endsAt: row.endsAt.toISOString(),
        readings: points.length,
        first: points[0] ?? null,
        latest,
        average,
        vsAveragePct: latest && average ? Math.round(((latest.interactions - average) / average) * 100) : null,
      };
    }),
    ended: ended.map((row) => ({ caption: postOf(row).caption, postedAt: postOf(row).postedAt, duration: row.duration, endedAt: row.endedAt?.toISOString() ?? "", outcome: (row.outcome as unknown as MonitorOutcome | null) ?? null })),
  };
}
