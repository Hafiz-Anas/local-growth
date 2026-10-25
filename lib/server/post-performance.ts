import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { isMethod } from "@/lib/analysis/methods";
import { accountStats, fingerprint, type AnalysisPost } from "@/lib/analysis/posts";
import { postSeries, postVsAverage, recentSummary } from "@/lib/analysis/post-performance";
import { getAIService } from "@/lib/services/ai";
import { ANALYSIS_PROMPT_VERSION, postDataBlock, type PostInsight } from "@/lib/services/text/analysis";
import type { AiTextState, PostDetailDto, PostPerformanceDto } from "@/types";
import { ApiError, notFound } from "./http";
import { ownPosts } from "./post-data";
import { getRateLimiter, POST_INSIGHT_LIMIT } from "./rate-limit";

/**
 * Post performance (feature "postInsights"): every recent post against the account's average,
 * its metrics day by day (PostSnapshot, taken by the daily cron) and a short AI explanation,
 * cached in PostInsight until the post's numbers change. Numbers never depend on the AI.
 */

/** Recent posts compared on the overview. */
export const RECENT_POSTS = 10;
/** Posts that get a daily snapshot: the ones still collecting interactions. */
const SNAPSHOT_MAX_AGE_DAYS = 45;
const DAY = 24 * 60 * 60 * 1000;

const today = () => new Date().toISOString().slice(0, 10);

export async function postPerformance(businessId: string): Promise<PostPerformanceDto> {
  const own = await ownPosts(businessId);
  const stats = accountStats(own.posts, own.followers, own.timeZone);
  return {
    connected: own.connected,
    demo: own.demo,
    summary: recentSummary(own.posts, RECENT_POSTS),
    media: Object.fromEntries([...own.media].map(([id, m]) => [id, { mediaUrl: m.mediaUrl, permalink: m.permalink ?? null }])),
    // Moved here from Statistics (config/insights.ts): best first.
    whatWorks: stats && {
      posts: stats.posts,
      mix: [...stats.mix].sort((a, b) => b.avgInteractions - a.avgInteractions),
      days: [...stats.byWeekday].sort((a, b) => b.avgInteractions - a.avgInteractions),
    },
  };
}

/** Changes only when the post's numbers change noticeably (not every day). */
function insightHash(post: AnalysisPost, averages: Array<number | null>): string {
  const r = (n: number | null) => (n === null ? null : n < 100 ? n : Number(n.toPrecision(2)));
  return fingerprint({ v: ANALYSIS_PROMPT_VERSION, id: post.id, m: [post.likes, post.comments, post.reach, post.saves, post.shares, post.views].map(r), a: averages.map(r) });
}

async function buildDetail(businessId: string, igMediaId: string) {
  const own = await ownPosts(businessId);
  const post = own.posts.find((p) => p.id === igMediaId);
  if (!post) throw notFound("Post");
  const [snapshots, method, cached] = await Promise.all([
    db.postSnapshot.findMany({ where: { businessId, igMediaId }, orderBy: { date: "asc" }, take: 60, select: { date: true, likes: true, comments: true, reach: true, saves: true, shares: true, views: true } }),
    db.postMethod.findUnique({ where: { businessId_igMediaId: { businessId, igMediaId } }, select: { method: true, promoted: true } }),
    db.postInsight.findUnique({ where: { businessId_igMediaId: { businessId, igMediaId } }, select: { inputHash: true, insight: true, generatedAt: true } }),
  ]);
  const peers = own.posts.filter((p) => p.id !== igMediaId).slice(0, 20);
  const vsAverage = postVsAverage(post, peers);
  const history = postSeries(snapshots);
  const hash = insightHash(post, vsAverage.map((m) => m.average));
  const insight: AiTextState<PostInsight> = cached
    ? { status: cached.inputHash === hash ? "ready" : "stale", text: cached.insight as unknown as PostInsight, generatedAt: cached.generatedAt.toISOString(), reason: null }
    : { status: "none", text: null, generatedAt: null, reason: null };
  const media = own.media.get(igMediaId);
  const detail: PostDetailDto = {
    post: { ...post, mediaUrl: media?.mediaUrl ?? null, permalink: media?.permalink ?? null },
    method: isMethod(method?.method) ? method.method : null,
    promoted: method?.promoted ?? false,
    vsAverage,
    history,
    comparedWith: peers.length,
    demo: own.demo,
    insight,
  };
  return { detail, hash };
}

export async function postDetail(businessId: string, igMediaId: string): Promise<PostDetailDto> {
  return (await buildDetail(businessId, igMediaId)).detail;
}

/**
 * The AI's explanation of one post, written when missing or out of date (POST_INSIGHT_LIMIT per
 * business per hour, plus the AI's daily budget). A failure returns "unavailable" with the reason.
 */
export async function explainPost(businessId: string, igMediaId: string): Promise<AiTextState<PostInsight>> {
  const { detail, hash } = await buildDetail(businessId, igMediaId);
  if (detail.insight.status === "ready") return detail.insight;
  if (!(await getRateLimiter().consume(POST_INSIGHT_LIMIT, businessId))) {
    throw new ApiError(429, "analysis_limit", "You've asked for many explanations in the last hour. The numbers are all here; try again later.");
  }
  const business = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { name: true, nameAr: true } });
  const answer = await getAIService().postInsight({
    businessId,
    businessName: business.name,
    businessNameAr: business.nameAr,
    data: postDataBlock({
      businessName: business.name,
      businessNameAr: business.nameAr,
      format: detail.post.format,
      postedAt: detail.post.postedAt,
      caption: detail.post.caption,
      method: detail.method,
      promoted: detail.promoted,
      vsAverage: detail.vsAverage,
      growth: detail.history.growth,
      days: detail.history.points.length,
    }),
  });
  if (!answer.ok) return { ...detail.insight, status: detail.insight.text ? "stale" : "unavailable", reason: answer.reason };
  const now = new Date();
  const data = { inputHash: hash, insight: answer.insight as unknown as Prisma.InputJsonObject, generatedAt: now };
  await db.postInsight.upsert({ where: { businessId_igMediaId: { businessId, igMediaId } }, create: { businessId, igMediaId, ...data }, update: data });
  return { status: "ready", text: answer.insight, generatedAt: now.toISOString(), reason: null };
}

/** Daily cron: today's numbers for every recent post (one row per post per day; re-runs overwrite). */
export async function snapshotPosts(businessId: string): Promise<number> {
  const own = await ownPosts(businessId);
  const date = today();
  const recent = own.posts.filter((p) => Date.now() - Date.parse(p.postedAt) <= SNAPSHOT_MAX_AGE_DAYS * DAY);
  for (const p of recent) {
    const values = { likes: p.likes, comments: p.comments, reach: p.reach, saves: p.saves, shares: p.shares, views: p.views, takenAt: new Date() };
    await db.postSnapshot.upsert({
      where: { businessId_igMediaId_date: { businessId, igMediaId: p.id, date } },
      create: { businessId, igMediaId: p.id, date, ...values },
      update: values,
    });
  }
  return recent.length;
}
