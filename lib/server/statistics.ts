import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { fingerprint } from "@/lib/analysis/posts";
import { computeStatistics, type FollowerSnapshot, type StatRange, type StatisticsData } from "@/lib/analysis/statistics";
import { isFeatureEnabled, permissionsFromRows } from "@/lib/permissions";
import { getAIService } from "@/lib/services/ai";
import { getInstagramService } from "@/lib/services/instagram";
import { fetchProfile } from "@/lib/services/meta/api";
import { STATISTICS_PROMPT_VERSION, statisticsDataBlock } from "@/lib/services/text/statistics";
import type { AiTextState, StatisticsDto, StatisticsSummaryText } from "@/types";
import { ApiError } from "./http";
import { getInstagramAccount } from "./instagram-account";
import { coolingDown, graphFor } from "./meta-client";
import { ownPosts } from "./post-data";
import { STATISTICS_SUMMARY_LIMIT, getRateLimiter } from "./rate-limit";

/**
 * Statistics (feature "statistics"): account-level numbers over 7 days … 1 year, computed in code
 * from what the app stores — a follower count per day (InstagramAccountSnapshot, written by the
 * sync and by the daily job) and every synced post — because Instagram itself only gives recent
 * data. A short AI summary of the period is cached per range until its numbers change; the page
 * shows the numbers and charts without it.
 */

/** Posts read for the longest range. */
const MAX_POSTS = 500;
const SNAPSHOT_DAYS = 2 * 366;
const DAY = 24 * 60 * 60 * 1000;
const today = () => new Date().toISOString().slice(0, 10);

interface Inputs {
  data: StatisticsData;
  demo: boolean;
  connected: boolean;
  /** Demo (mock) accounts: follower counts before the first stored day come from the sample data. */
  sampleFollowers: boolean;
}

async function inputs(businessId: string, range: StatRange): Promise<Inputs> {
  const [own, stored] = await Promise.all([
    ownPosts(businessId, MAX_POSTS),
    db.instagramAccountSnapshot.findMany({ where: { businessId, date: { gte: new Date(Date.now() - SNAPSHOT_DAYS * DAY).toISOString().slice(0, 10) } }, orderBy: { date: "asc" }, select: { date: true, followers: true } }),
  ]);
  let snapshots: FollowerSnapshot[] = stored;
  let sampleFollowers = false;
  if (own.demo && own.connected) {
    // The demo accounts' sample follower history fills the days before the first stored count.
    const account = await getInstagramAccount(businessId);
    const series = (await getInstagramService().getInsights(account).catch(() => null))?.followerSeries ?? [];
    const first = stored[0]?.date ?? "9999-12-31";
    const sample = series.filter((p) => p.date < first).map((p) => ({ date: p.date, followers: p.followers }));
    sampleFollowers = sample.length > 0;
    snapshots = [...sample, ...stored];
  }
  const data = computeStatistics({ range, posts: own.posts, snapshots, currentFollowers: own.followers, timeZone: own.timeZone });
  return { data, demo: own.demo, connected: own.connected, sampleFollowers };
}

const hashOf = (block: string, range: StatRange) => fingerprint({ v: STATISTICS_PROMPT_VERSION, range, block });

export async function getStatistics(businessId: string, range: StatRange): Promise<StatisticsDto> {
  const { data, demo, connected, sampleFollowers } = await inputs(businessId, range);
  const block = statisticsDataBlock(data, { demo });
  const cached = await db.statisticsSummary.findUnique({ where: { businessId_range: { businessId, range } }, select: { inputHash: true, summary: true, generatedAt: true } });
  const summary: AiTextState<StatisticsSummaryText> = !data.current.posts && !data.followers
    ? { status: "unavailable", text: null, generatedAt: null, reason: "no_data" }
    : cached
      ? { status: cached.inputHash === hashOf(block, range) ? "ready" : "stale", text: cached.summary as unknown as StatisticsSummaryText, generatedAt: cached.generatedAt.toISOString(), reason: null }
      : { status: "none", text: null, generatedAt: null, reason: null };
  return { ...data, connected, demo, sampleFollowers, summary };
}

/**
 * POST /api/statistics/summary?range= — the AI's summary of the period, written when missing or
 * out of date (STATISTICS_SUMMARY_LIMIT per business per hour, plus the AI's daily budget).
 */
export async function explainStatistics(businessId: string, range: StatRange): Promise<AiTextState<StatisticsSummaryText>> {
  const { data, demo } = await inputs(businessId, range);
  if (!data.current.posts && !data.followers) return { status: "unavailable", text: null, generatedAt: null, reason: "no_data" };
  const block = statisticsDataBlock(data, { demo });
  const hash = hashOf(block, range);
  const cached = await db.statisticsSummary.findUnique({ where: { businessId_range: { businessId, range } }, select: { inputHash: true, summary: true, generatedAt: true } });
  if (cached?.inputHash === hash) return { status: "ready", text: cached.summary as unknown as StatisticsSummaryText, generatedAt: cached.generatedAt.toISOString(), reason: null };
  if (!(await getRateLimiter().consume(STATISTICS_SUMMARY_LIMIT, businessId))) {
    throw new ApiError(429, "analysis_limit", "You've asked for many summaries in the last hour. The numbers are all here; try again later.");
  }
  const business = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { name: true, nameAr: true } });
  const answer = await getAIService().statisticsSummary({ businessId, businessName: business.name, businessNameAr: business.nameAr, data: block });
  if (!answer.ok) {
    return cached
      ? { status: "stale", text: cached.summary as unknown as StatisticsSummaryText, generatedAt: cached.generatedAt.toISOString(), reason: answer.reason }
      : { status: "unavailable", text: null, generatedAt: null, reason: answer.reason };
  }
  const now = new Date();
  const values = { inputHash: hash, summary: { en: answer.en, ar: answer.ar } as Prisma.InputJsonObject, generatedAt: now };
  await db.statisticsSummary.upsert({ where: { businessId_range: { businessId, range } }, create: { businessId, range, ...values }, update: values });
  return { status: "ready", text: { en: answer.en, ar: answer.ar }, generatedAt: now.toISOString(), reason: null };
}

/** The 30-day numbers for the assistant's Analytics mode (no AI call). */
export async function statisticsFacts(businessId: string): Promise<{ data: StatisticsData; demo: boolean } | null> {
  const { data, demo, connected } = await inputs(businessId, "30d");
  return connected ? { data, demo } : null;
}

// ─── The daily follower count ────────────────────────────────────────────────

export interface StatisticsSweepSummary {
  snapshots: number;
  skipped: number;
  failed: number;
}

/**
 * Daily job: one follower count per day for every business with Statistics on, so longer trends
 * build up even when nobody opens the app (the Instagram sync writes one too; a day that already
 * has one is left alone). Meta: one profile call, skipped while Meta asks us to slow down.
 */
export async function runStatisticsSweep(deadlineMs: number): Promise<StatisticsSweepSummary> {
  const started = Date.now();
  const summary: StatisticsSweepSummary = { snapshots: 0, skipped: 0, failed: 0 };
  const date = today();
  const businesses = await db.business.findMany({
    where: { instagramConnection: { status: "CONNECTED" }, accountSnapshots: { none: { date } } },
    select: { id: true, permissions: { select: { featureKey: true, enabled: true } } },
  });
  for (const business of businesses) {
    if (Date.now() - started > deadlineMs) break;
    if (!isFeatureEnabled(permissionsFromRows(business.permissions), "statistics")) continue;
    try {
      const account = await getInstagramAccount(business.id);
      if (!account.connected) {
        summary.skipped += 1;
        continue;
      }
      let counts: { followers: number; follows: number; mediaCount: number };
      if (account.provider === "meta") {
        if (coolingDown(business.id) || !account.igUserId || !account.accessToken) {
          summary.skipped += 1;
          continue;
        }
        const profile = await fetchProfile(graphFor(business.id), account.igUserId, account.accessToken);
        counts = { followers: profile.followers, follows: profile.follows, mediaCount: profile.mediaCount };
      } else {
        const profile = await getInstagramService().getProfile(account);
        counts = { followers: profile.followers, follows: profile.following, mediaCount: profile.posts };
      }
      await db.instagramAccountSnapshot.upsert({
        where: { businessId_date: { businessId: business.id, date } },
        create: { businessId: business.id, date, ...counts },
        update: { ...counts, takenAt: new Date() },
      });
      summary.snapshots += 1;
    } catch (error) {
      summary.failed += 1;
      console.error("[statistics] daily follower count failed", business.id, (error as Error).message);
    }
  }
  return summary;
}
