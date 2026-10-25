import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { isMethod, ruleMethod } from "@/lib/analysis/methods";
import { fingerprint } from "@/lib/analysis/posts";
import { computeShareability, postShareRate, SHARE_MIN_POSTS, SHARE_MIN_POSTS_FOR_PATTERNS, SHARE_MIN_REACH, type PostShareRate, type ShareabilityData } from "@/lib/analysis/shareability";
import { isFeatureEnabled, permissionsFromRows } from "@/lib/permissions";
import { getAIService } from "@/lib/services/ai";
import { SHAREABILITY_PROMPT_VERSION, shareabilityDataBlock, shareabilityFactLines, type ShareFinding } from "@/lib/services/text/shareability";
import type { AiTextState, ShareabilityDto } from "@/types";
import { aiPace } from "./ai-pace";
import { ApiError } from "./http";
import { syncInstagram } from "./instagram-sync";
import { ownPosts, type OwnPosts } from "./post-data";
import { getRateLimiter, SHARE_FINDINGS_LIMIT } from "./rate-limit";

/**
 * Shareability (feature "postInsights.shareability"): shares ÷ reach per post from Instagram's post
 * insights, "Most shared" on Post performance, the share rate on a post's detail, and 1–3 AI findings
 * on what the most-shared posts have in common (cached in ShareFindings, rewritten at most once a
 * day). The findings and numbers also go into the weekly Recommendations. Numbers never depend on the AI.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** Findings are rewritten at most this often, even when the numbers change. */
export const FINDINGS_MAX_AGE_MS = DAY;
/** After a failed attempt (AI unavailable), wait this long before trying again. */
const FINDINGS_RETRY_MS = HOUR;

async function inputs(businessId: string): Promise<{ own: OwnPosts; data: ShareabilityData }> {
  const own = await ownPosts(businessId);
  const stored = new Map(
    (await db.postMethod.findMany({ where: { businessId, igMediaId: { in: own.posts.map((p) => p.id) } }, select: { igMediaId: true, method: true } })).map((m) => [m.igMediaId, m.method]),
  );
  const data = computeShareability(own.posts, {
    timeZone: own.timeZone,
    // The owner's or the AI's marketing method when there is one, else the caption rule.
    topicOf: (post) => {
      const method = stored.get(post.id);
      return isMethod(method) ? method : ruleMethod(post.caption, own.handle);
    },
  });
  return { own, data };
}

const hashOf = (block: string) => fingerprint({ v: SHAREABILITY_PROMPT_VERSION, block });

type Cached = { inputHash: string; findings: Prisma.JsonValue; generatedAt: Date; failedAt: Date | null } | null;

const findingsOf = (cached: NonNullable<Cached>) => (Array.isArray(cached.findings) ? (cached.findings as unknown as ShareFinding[]) : []);

/** The findings' state for the page: rewritten only when the numbers changed and the last ones are a day old. */
function findingsState(data: ShareabilityData, hash: string, cached: Cached, now = Date.now()): AiTextState<ShareFinding[]> {
  if (data.posts < SHARE_MIN_POSTS_FOR_PATTERNS) return { status: "unavailable", text: null, generatedAt: null, reason: "not_enough_posts" };
  const findings = cached ? findingsOf(cached) : [];
  if (cached && findings.length) {
    const fresh = cached.inputHash === hash || now - cached.generatedAt.getTime() < FINDINGS_MAX_AGE_MS;
    return { status: fresh ? "ready" : "stale", text: findings, generatedAt: cached.generatedAt.toISOString(), reason: null };
  }
  if (cached?.failedAt && now - cached.failedAt.getTime() < FINDINGS_RETRY_MS) return { status: "unavailable", text: null, generatedAt: null, reason: "unavailable" };
  return { status: "none", text: null, generatedAt: null, reason: null };
}

/** GET /api/shareability — "Most shared" and the cached findings (no AI call). */
export async function getShareability(businessId: string): Promise<ShareabilityDto> {
  const { own, data } = await inputs(businessId);
  const cached = await db.shareFindings.findUnique({ where: { businessId }, select: { inputHash: true, findings: true, generatedAt: true, failedAt: true } });
  const block = shareabilityDataBlock(data, { demo: own.demo });
  return {
    connected: own.connected,
    demo: own.demo,
    // Nothing from Instagram yet (metric or permission missing, or posts too new) → "Not available yet".
    status: data.posts >= SHARE_MIN_POSTS ? "ready" : data.posts > 0 || data.excluded.lowReach > 0 ? "not_enough_posts" : "unavailable",
    minReach: SHARE_MIN_REACH,
    minPosts: SHARE_MIN_POSTS,
    averagePct: data.averagePct,
    posts: data.posts,
    excluded: data.excluded,
    mostShared: data.mostShared.map((p) => ({
      id: p.id,
      caption: p.caption,
      format: p.format,
      postedAt: p.postedAt,
      shares: p.shares,
      reach: p.reach,
      ratePct: p.ratePct,
      vsAverage: p.vsAverage,
      mediaUrl: own.media.get(p.id)?.mediaUrl ?? null,
    })),
    findings: findingsState(data, hashOf(block), cached),
  };
}

/**
 * The findings, written when missing or out of date — at most once a day (FINDINGS_MAX_AGE_MS),
 * retried an hour after a failure. From the page: SHARE_FINDINGS_LIMIT per business per hour; the
 * daily cron calls it paced (aiPace). Both go through the AI's request gate and daily budget.
 */
export async function explainShareability(businessId: string, { from }: { from: "page" | "cron" }): Promise<AiTextState<ShareFinding[]>> {
  const { own, data } = await inputs(businessId);
  const block = shareabilityDataBlock(data, { demo: own.demo });
  const hash = hashOf(block);
  const cached = await db.shareFindings.findUnique({ where: { businessId }, select: { inputHash: true, findings: true, generatedAt: true, failedAt: true } });
  const state = findingsState(data, hash, cached);
  if (state.status !== "none" && state.status !== "stale") return state;
  // Out of date, but the last attempt failed less than an hour ago: keep the old findings for now.
  if (state.status === "stale" && cached?.failedAt && Date.now() - cached.failedAt.getTime() < FINDINGS_RETRY_MS) return state;

  if (from === "page" && !(await getRateLimiter().consume(SHARE_FINDINGS_LIMIT, businessId))) {
    throw new ApiError(429, "analysis_limit", "You've asked for many explanations in the last hour. The numbers are all here; try again later.");
  }
  if (from === "cron") await aiPace();
  const business = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { name: true, nameAr: true } });
  const answer = await getAIService().shareFindings({ businessId, businessName: business.name, businessNameAr: business.nameAr, data: block, numbers: data });
  const now = new Date();
  if (!answer.ok) {
    await db.shareFindings.upsert({
      where: { businessId },
      create: { businessId, inputHash: "", findings: [], failedAt: now },
      update: { failedAt: now },
    });
    return state.status === "stale" ? { ...state, reason: answer.reason } : { status: "unavailable", text: null, generatedAt: null, reason: answer.reason };
  }
  const values = { inputHash: hash, findings: answer.findings as unknown as Prisma.InputJsonArray, generatedAt: now, failedAt: null };
  await db.shareFindings.upsert({ where: { businessId }, create: { businessId, ...values }, update: values });
  return { status: "ready", text: answer.findings, generatedAt: now.toISOString(), reason: null };
}

/** A post's share rate for its detail page (null when the feature is off). */
export function shareRateFor(own: OwnPosts, igMediaId: string): PostShareRate | null {
  const post = own.posts.find((p) => p.id === igMediaId);
  if (!post) return null;
  return postShareRate(post, computeShareability(own.posts, { timeZone: own.timeZone }));
}

/** The share numbers and cached findings as labelled lines for the weekly Recommendations (no AI call). */
export async function shareabilityFacts(businessId: string): Promise<string[]> {
  const { own, data } = await inputs(businessId);
  if (!own.connected) return [];
  const cached = await db.shareFindings.findUnique({ where: { businessId }, select: { inputHash: true, findings: true, generatedAt: true, failedAt: true } });
  return shareabilityFactLines(data, cached ? findingsOf(cached) : []);
}

/** Whether a business has "Most shared" (its module and the sub-feature on). */
export async function hasShareability(businessId: string): Promise<boolean> {
  const rows = await db.featurePermission.findMany({ where: { businessId }, select: { featureKey: true, enabled: true } });
  return isFeatureEnabled(permissionsFromRows(rows), "postInsights.shareability");
}

// ─── The daily cron ──────────────────────────────────────────────────────────

export interface ShareabilitySweepSummary {
  refreshed: number;
  findings: number;
  failed: number;
  stoppedEarly: boolean;
}

/**
 * Part of GET /api/cron/daily, before Recommendations: refreshes the recent posts' insights (shares,
 * reach…) of Meta-connected businesses, then writes the findings where they're due (once a day at most).
 */
export async function runShareabilitySweep(deadlineMs: number): Promise<ShareabilitySweepSummary> {
  const started = Date.now();
  const summary: ShareabilitySweepSummary = { refreshed: 0, findings: 0, failed: 0, stoppedEarly: false };
  const businesses = await db.business.findMany({
    where: {
      instagramConnection: { isNot: null },
      AND: [{ permissions: { some: { featureKey: "postInsights", enabled: true } } }, { permissions: { some: { featureKey: "postInsights.shareability", enabled: true } } }],
    },
    select: { id: true, instagramConnection: { select: { provider: true, status: true } } },
  });
  for (const business of businesses) {
    if (Date.now() - started > deadlineMs) {
      summary.stoppedEarly = true;
      break;
    }
    try {
      const conn = business.instagramConnection;
      if (conn?.provider === "META" && conn.status === "CONNECTED") {
        const result = await syncInstagram(business.id, { scope: "postInsights", reason: "auto" });
        if (result.ok) summary.refreshed += 1;
      }
      const state = await explainShareability(business.id, { from: "cron" });
      if (state.status === "ready" && state.generatedAt && Date.parse(state.generatedAt) >= started) summary.findings += 1;
    } catch (error) {
      summary.failed += 1;
      console.error("[shareability] daily sweep failed", business.id, (error as Error).message);
    }
  }
  return summary;
}
