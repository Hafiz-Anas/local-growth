import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { methodMix } from "@/lib/analysis/methods";
import { accountStats, compareAccounts, fingerprint, interactions, weeklyGrowth, type AnalysisPost } from "@/lib/analysis/posts";
import { isFeatureEnabled, permissionsFromRows } from "@/lib/permissions";
import { getAIService } from "@/lib/services/ai";
import { getInstagramService, type CompetitorProfile } from "@/lib/services/instagram";
import { ANALYSIS_PROMPT_VERSION, competitorDataBlock, type CompetitorInsight } from "@/lib/services/text/analysis";
import type { AiTextState, AnalysisPostDto, CompetitorAnalysisDto, CompetitorAnalysisItemDto } from "@/types";
import { aiPace } from "./ai-pace";
import { recordCompetitorFetch, competitorProfileFor } from "./competitor-profiles";
import { competitorLimit, findOwnCompetitor } from "./competitors";
import { ApiError } from "./http";
import { getInstagramAccount } from "./instagram-account";
import { coolingDown } from "./meta-client";
import { competitorPosts, ownPosts, type OwnPosts } from "./post-data";
import { getRateLimiter, COMPETITOR_INSIGHT_LIMIT } from "./rate-limit";

/**
 * Competitor analysis (feature competitors.analysis): measured numbers for the business and each
 * tracked competitor (lib/analysis/posts.ts), their weekly growth (CompetitorSnapshot), and the
 * AI's plain-language comparison, cached in CompetitorAnalysis until the numbers change
 * (`inputHash`). Data comes only from the Instagram API (business discovery) — no scraping.
 */

const WEEK = 7 * 24 * 60 * 60 * 1000;
const CRON_SLACK = 6 * 60 * 60 * 1000;
/** AI comparisons written per cron run (each is one model call, spaced by aiPace). */
const CRON_AI_BATCH = Number(process.env.COMPETITOR_CRON_BATCH ?? 10);

const sig2 = (n: number) => (n < 100 ? n : Number(n.toPrecision(2)));

/** Changes only when the posts or their numbers change noticeably (not as time passes). */
function inputHash(you: AnalysisPost[], them: AnalysisPost[], themFollowers: number, youFollowers: number | null): string {
  const key = (posts: AnalysisPost[]) => posts.map((p) => [p.id, sig2(p.likes), sig2(p.comments)]);
  return fingerprint({ v: ANALYSIS_PROMPT_VERSION, you: key(you), them: key(them), f: [sig2(themFollowers), youFollowers === null ? null : sig2(youFollowers)] });
}

const toPostDto = (p: AnalysisPost, extra?: { mediaUrl?: string | null; permalink?: string | null }): AnalysisPostDto => ({
  ...p,
  mediaUrl: extra?.mediaUrl ?? null,
  permalink: extra?.permalink ?? null,
});

interface Built {
  item: CompetitorAnalysisItemDto;
  hash: string | null;
  input: Parameters<typeof competitorDataBlock>[0] | null;
}

async function buildItem(
  businessId: string,
  own: OwnPosts,
  business: { name: string; nameAr: string | null },
  row: { id: string; handle: string; displayName: string | null; avatarUrl: string | null; followers: number; lastFetchedAt: Date | null; lookupIssue: string | null },
  profile: CompetitorProfile | null,
): Promise<Built> {
  const [snapshots, cached] = await Promise.all([
    db.competitorSnapshot.findMany({ where: { competitorId: row.id, takenAt: { gte: new Date(Date.now() - 26 * WEEK) } }, select: { takenAt: true, followers: true, engagementRate: true }, orderBy: { takenAt: "asc" } }),
    db.competitorAnalysis.findUnique({ where: { competitorId: row.id }, select: { inputHash: true, insight: true, failureReason: true, generatedAt: true } }),
  ]);
  const posts = profile ? competitorPosts(profile) : [];
  const followers = profile?.followers ?? row.followers;
  const stats = accountStats(posts, followers, own.timeZone);
  const youStats = accountStats(own.posts, own.followers, own.timeZone);
  const growth = weeklyGrowth(snapshots);
  const methods = methodMix(posts, row.handle);
  const best = [...posts].sort((a, b) => interactions(b) - interactions(a)).slice(0, 3);
  const media = new Map(profile?.recentPosts.map((p) => [p.id, p]) ?? []);
  const hash = stats ? inputHash(own.posts, posts, followers, own.followers) : null;
  const comparison = compareAccounts(youStats, stats);

  let insight: AiTextState<CompetitorInsight> = { status: "none", text: null, generatedAt: null, reason: null };
  if (cached?.insight) insight = { status: cached.inputHash === hash ? "ready" : "stale", text: cached.insight as unknown as CompetitorInsight, generatedAt: cached.generatedAt.toISOString(), reason: null };
  else if (cached && cached.inputHash === hash) insight = { status: "unavailable", text: null, generatedAt: cached.generatedAt.toISOString(), reason: cached.failureReason };

  return {
    item: {
      id: row.id,
      handle: row.handle,
      name: row.displayName ?? profile?.name ?? row.handle,
      avatarUrl: profile?.avatarUrl ?? row.avatarUrl,
      followers,
      issue: (["private", "not_business", "not_found"] as const).find((i) => i === row.lookupIssue) ?? null,
      dataAt: row.lastFetchedAt?.toISOString() ?? null,
      stats,
      bestPosts: best.map((p) => toPostDto(p, { mediaUrl: media.get(p.id)?.mediaUrl, permalink: media.get(p.id)?.permalink })),
      comparison,
      methods,
      growth,
      insight,
    },
    hash,
    input: stats
      ? {
          businessName: business.name,
          businessNameAr: business.nameAr,
          handle: row.handle,
          you: youStats,
          youFollowers: own.followers,
          them: stats,
          themFollowers: followers,
          comparison,
          growth: { changePct: growth.changePct, weeks: growth.weeks },
          methods,
          bestCaptions: best.map((p) => p.caption),
        }
      : null,
  };
}

const COMPETITOR_ROW = { id: true, handle: true, displayName: true, avatarUrl: true, followers: true, lastFetchedAt: true, lookupIssue: true } as const;

/** Every tracked competitor vs the business: numbers, growth and the cached AI text (never calls the AI). */
export async function competitorAnalysis(businessId: string): Promise<CompetitorAnalysisDto> {
  const [own, business, rows, limit, account] = await Promise.all([
    ownPosts(businessId),
    db.business.findUniqueOrThrow({ where: { id: businessId }, select: { name: true, nameAr: true } }),
    db.competitor.findMany({ where: { businessId, validationStatus: "READY" }, select: COMPETITOR_ROW, orderBy: { followers: "desc" } }),
    competitorLimit(businessId),
    getInstagramAccount(businessId),
  ]);
  const profiles = await Promise.all(rows.map((row) => competitorProfileFor(account, row)));
  const items = await Promise.all(rows.map((row, i) => buildItem(businessId, own, business, row, profiles[i])));
  return {
    you: { handle: own.handle, followers: own.followers, stats: accountStats(own.posts, own.followers, own.timeZone), demo: own.demo, connected: own.connected },
    competitors: items.map((b) => b.item),
    limit,
    tracked: rows.length,
    timeZone: own.timeZone,
  };
}

/** Writes (or keeps) the AI comparison for one competitor. Returns the new state. */
async function writeInsight(businessId: string, built: Built): Promise<AiTextState<CompetitorInsight>> {
  if (!built.input || !built.hash) return built.item.insight;
  if (built.item.insight.status === "ready") return built.item.insight;
  const answer = await getAIService().competitorInsight({
    businessId,
    businessName: built.input.businessName,
    businessNameAr: built.input.businessNameAr,
    handle: built.input.handle,
    data: competitorDataBlock(built.input),
  });
  const now = new Date();
  if (!answer.ok) {
    // Keep older text if there is some (shown as "stale"); remember the failure for these numbers.
    const kept = built.item.insight.text;
    await db.competitorAnalysis.upsert({
      where: { competitorId: built.item.id },
      create: { competitorId: built.item.id, inputHash: kept ? "stale" : built.hash, insight: kept ? (kept as unknown as Prisma.InputJsonObject) : undefined, failureReason: answer.reason, generatedAt: now },
      update: kept ? { failureReason: answer.reason } : { inputHash: built.hash, insight: undefined, failureReason: answer.reason, generatedAt: now },
    });
    return { status: kept ? "stale" : "unavailable", text: kept, generatedAt: built.item.insight.generatedAt, reason: answer.reason };
  }
  const data = { inputHash: built.hash, insight: answer.insight as unknown as Prisma.InputJsonObject, failureReason: null, generatedAt: now };
  await db.competitorAnalysis.upsert({ where: { competitorId: built.item.id }, create: { competitorId: built.item.id, ...data }, update: data });
  return { status: "ready", text: answer.insight, generatedAt: now.toISOString(), reason: null };
}

/**
 * "Explain" for one competitor (the page asks when the text is missing or stale): one AI call,
 * counted against COMPETITOR_INSIGHT_LIMIT per business and the AI's daily budget.
 */
export async function explainCompetitor(businessId: string, competitorId: string): Promise<AiTextState<CompetitorInsight>> {
  await findOwnCompetitor(businessId, competitorId);
  const [own, business, row, account] = await Promise.all([
    ownPosts(businessId),
    db.business.findUniqueOrThrow({ where: { id: businessId }, select: { name: true, nameAr: true } }),
    db.competitor.findUniqueOrThrow({ where: { id: competitorId }, select: COMPETITOR_ROW }),
    getInstagramAccount(businessId),
  ]);
  const built = await buildItem(businessId, own, business, row, await competitorProfileFor(account, row));
  if (built.item.insight.status === "ready" || !built.input) return built.item.insight;
  if (built.item.insight.status === "unavailable" && built.item.insight.generatedAt && Date.now() - Date.parse(built.item.insight.generatedAt) < 10 * 60_000) {
    return built.item.insight; // failed for these numbers moments ago: don't hammer the AI
  }
  if (!(await getRateLimiter().consume(COMPETITOR_INSIGHT_LIMIT, businessId))) {
    throw new ApiError(429, "analysis_limit", "You've asked for many explanations in the last hour. The numbers are all here; try again later.");
  }
  return writeInsight(businessId, built);
}

// ── Weekly cron ─────────────────────────────────────────────────────────────────

export interface CompetitorSweepSummary {
  refreshed: number;
  unavailable: number;
  explained: number;
  failed: number;
  stoppedEarly: boolean;
}

/**
 * Part of the daily cron: competitors whose last snapshot is a week old are looked up again
 * (a CompetitorSnapshot each time → growth over time; private / not found accounts are flagged),
 * then the AI comparison is rewritten only where the numbers changed.
 */
export async function runCompetitorSweep(deadlineMs: number): Promise<CompetitorSweepSummary> {
  const started = Date.now();
  const summary: CompetitorSweepSummary = { refreshed: 0, unavailable: 0, explained: 0, failed: 0, stoppedEarly: false };
  const businesses = await db.business.findMany({
    where: { permissions: { some: { featureKey: "competitors.analysis", enabled: true } }, competitors: { some: { validationStatus: "READY" } } },
    select: { id: true, name: true, nameAr: true, permissions: { select: { featureKey: true, enabled: true } } },
  });
  const ig = getInstagramService();
  for (const business of businesses) {
    if (!isFeatureEnabled(permissionsFromRows(business.permissions), "competitors.analysis")) continue;
    if (Date.now() - started > deadlineMs) {
      summary.stoppedEarly = true;
      break;
    }
    const account = await getInstagramAccount(business.id);
    if (!account.connected || (account.provider === "meta" && coolingDown(business.id))) continue;
    const rows = await db.competitor.findMany({ where: { businessId: business.id, validationStatus: "READY" }, select: { ...COMPETITOR_ROW, snapshots: { orderBy: { takenAt: "desc" }, take: 1, select: { takenAt: true } } } });
    const own = await ownPosts(business.id);
    for (const row of rows) {
      if (Date.now() - started > deadlineMs) {
        summary.stoppedEarly = true;
        break;
      }
      try {
        let profile: CompetitorProfile | null = null;
        const last = row.snapshots[0]?.takenAt.getTime() ?? 0;
        if (Date.now() - last >= WEEK - CRON_SLACK) {
          const lookup = await ig.lookupBusinessAccount(account, row.handle);
          if (lookup.status === "ready" && lookup.profile) {
            await recordCompetitorFetch(row.id, lookup.profile);
            await db.competitor.update({ where: { id: row.id }, data: { lookupIssue: null, lookupCheckedAt: new Date() } });
            profile = lookup.profile;
            row.lookupIssue = null;
            summary.refreshed += 1;
          } else {
            const issue = lookup.status === "own_account" ? "not_found" : lookup.status;
            await db.competitor.update({ where: { id: row.id }, data: { lookupIssue: issue, lookupCheckedAt: new Date() } });
            summary.unavailable += 1;
            continue;
          }
        }
        if (summary.explained >= CRON_AI_BATCH) continue;
        profile ??= await competitorProfileFor(account, row);
        const built = await buildItem(business.id, own, business, row, profile);
        if (built.item.insight.status === "ready" || !built.input) continue;
        await aiPace();
        const state = await writeInsight(business.id, built);
        if (state.status === "ready") summary.explained += 1;
      } catch (error) {
        summary.failed += 1;
        console.error("[competitors] weekly analysis failed", row.handle, (error as Error).message);
      }
    }
  }
  return summary;
}
