import "server-only";
import { after } from "next/server";
import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { getAIService } from "@/lib/services/ai";
import { fetchAccountInsights, fetchComments, fetchMedia, fetchPostInsights, fetchProfile } from "@/lib/services/meta/api";
import { MetaApiError } from "@/lib/services/meta/errors";
import type { AccountInsights } from "@/lib/services/meta/mappers";
import { getInstagramAccount, SYNC_STALE_MS, type SyncErrorCode } from "./instagram-account";
import { logIntegration } from "./integration-log";
import { coolingDown, graphFor, MetaUnavailableError } from "./meta-client";

/**
 * Copies a Meta-connected account into the database so pages never call Meta
 * on load:
 *   basic    → profile (+ a daily follower snapshot) and the last 50 posts
 *   deferred → account insights, post insights (recent posts), comments (+ AI reply drafts)
 *   full     → both
 * On connect, "basic" runs before the redirect and "deferred" right after it.
 * "Sync now" runs "full"; pages trigger a background "full" sync when the data is older than 6 hours.
 *
 * Only one sync runs per business (InstagramConnection.syncStartedAt). Meta's
 * rate limits are respected: background syncs skip a business that is cooling
 * down, and a rate-limit error ends the sync early.
 */

export type SyncScope = "basic" | "deferred" | "full";
export type SyncReason = "connect" | "manual" | "auto";

export interface SyncResult {
  ok: boolean;
  skipped?: "in_progress" | "not_connected" | "rate_limited" | "unavailable";
  error?: SyncErrorCode;
  retryAfterMs?: number;
  counts: { media: number; postInsights: number; comments: number; replyDrafts: number };
}

const DAY = 24 * 60 * 60 * 1000;
const MEDIA_LIMIT = 50;
/** Posts (newest, within 30 days) whose insights are refreshed per sync — keeps us well inside Meta's limits. */
const POST_INSIGHTS_LIMIT = 25;
/** Posts whose comments are refreshed per sync. */
const COMMENT_POSTS_LIMIT = 10;
/** New comments younger than this get an AI reply draft. */
const REPLY_DRAFT_MAX_AGE = 7 * DAY;
const REPLY_DRAFTS_PER_SYNC = 20;
export const AUTO_SYNC_AFTER_MS = 6 * 60 * 60 * 1000;

function errorCodeOf(error: unknown): SyncErrorCode {
  if (error instanceof MetaApiError) {
    if (error.kind === "token_invalid" || error.kind === "permission" || error.kind === "rate_limited" || error.kind === "transient") return error.kind;
  }
  return "failed";
}

const utcDate = (d = new Date()) => d.toISOString().slice(0, 10);

export async function syncInstagram(businessId: string, { scope = "full", reason }: { scope?: SyncScope; reason: SyncReason }): Promise<SyncResult> {
  const counts = { media: 0, postInsights: 0, comments: 0, replyDrafts: 0 };
  if (reason === "auto" && coolingDown(businessId)) return { ok: false, skipped: "rate_limited", retryAfterMs: coolingDown(businessId), counts };

  const lock = await db.instagramConnection.updateMany({
    where: { businessId, provider: "META", status: "CONNECTED", OR: [{ syncStartedAt: null }, { syncStartedAt: { lt: new Date(Date.now() - SYNC_STALE_MS) } }] },
    data: { syncStartedAt: new Date() },
  });
  if (lock.count !== 1) {
    const conn = await db.instagramConnection.findUnique({ where: { businessId }, select: { status: true, provider: true } });
    return { ok: false, skipped: conn?.provider === "META" && conn.status === "CONNECTED" ? "in_progress" : "not_connected", counts };
  }

  let error: SyncErrorCode | null = null;
  let retryAfterMs: number | undefined;
  let anyDone = false;
  try {
    const account = await getInstagramAccount(businessId);
    if (!account.connected || !account.igUserId || !account.accessToken) return { ok: false, skipped: "not_connected", counts };
    const ig = { id: account.igUserId, token: account.accessToken };
    const client = graphFor(businessId);

    if (scope !== "deferred") {
      // Profile + daily snapshot.
      const profile = await fetchProfile(client, ig.id, ig.token);
      await db.$transaction([
        db.instagramConnection.update({ where: { businessId }, data: { profile: profile as unknown as Prisma.InputJsonObject, ...(profile.username && { username: profile.username }) } }),
        db.instagramAccountSnapshot.upsert({
          where: { businessId_date: { businessId, date: utcDate() } },
          update: { followers: profile.followers, follows: profile.follows, mediaCount: profile.mediaCount, takenAt: new Date() },
          create: { businessId, date: utcDate(), followers: profile.followers, follows: profile.follows, mediaCount: profile.mediaCount },
        }),
      ]);
      // Keep the business's handle in step with a renamed account, unless another business uses it.
      if (profile.username && profile.username !== account.username) {
        const clash = await db.business.count({ where: { instagramHandle: profile.username, id: { not: businessId } } });
        if (!clash) await db.business.update({ where: { id: businessId }, data: { instagramHandle: profile.username } });
      }
      anyDone = true;

      // Last 50 posts. Posts deleted on Instagram (missing from the fetched range) are removed.
      const media = await fetchMedia(client, ig.id, ig.token, MEDIA_LIMIT);
      const now = new Date();
      for (const m of media) {
        const data = { ...m, syncedAt: now };
        await db.instagramMedia.upsert({ where: { businessId_igMediaId: { businessId, igMediaId: m.igMediaId } }, update: data, create: { businessId, ...data } });
      }
      if (media.length) {
        const oldest = media.reduce((min, m) => (m.postedAt < min ? m.postedAt : min), media[0].postedAt);
        await db.instagramMedia.deleteMany({ where: { businessId, postedAt: { gte: oldest }, igMediaId: { notIn: media.map((m) => m.igMediaId) } } });
      } else {
        await db.instagramMedia.deleteMany({ where: { businessId } });
      }
      counts.media = media.length;
    }

    if (scope !== "basic") {
      await syncInsights(businessId, client, ig, reason, counts);
      anyDone = true;
      await syncComments(businessId, client, ig, account.username, counts);
    }
  } catch (e) {
    if (e instanceof MetaUnavailableError) {
      error = "failed";
      await logIntegration({ businessId, call: "sync", errorCode: "meta_unavailable", message: e.message });
    } else {
      error = errorCodeOf(e);
      if (e instanceof MetaApiError && e.retryAfterMs) retryAfterMs = e.retryAfterMs;
      // Graph failures are already logged by the client; log anything else here.
      if (!(e instanceof MetaApiError)) await logIntegration({ businessId, call: "sync", errorCode: "failed", message: (e as Error)?.message ?? "Sync failed." });
    }
  } finally {
    await db.instagramConnection.update({
      where: { businessId },
      data: { syncStartedAt: null, lastSyncError: error, ...(anyDone && { lastSyncAt: new Date() }) },
    });
  }

  if (!error) {
    await logIntegration({ businessId, level: "info", call: `sync.${scope}`, message: `Synced (${reason}): ${counts.media} posts, ${counts.postInsights} post insights, ${counts.comments} comments, ${counts.replyDrafts} reply drafts.`, details: { reason, ...counts } });
  }
  return { ok: !error, ...(error && { error }), ...(retryAfterMs && { retryAfterMs }), counts };
}

async function syncInsights(businessId: string, client: ReturnType<typeof graphFor>, ig: { id: string; token: string }, reason: SyncReason, counts: SyncResult["counts"]) {
  const previous = await db.instagramConnection.findUnique({ where: { businessId }, select: { insights: true } });
  const insights = await fetchAccountInsights(client, ig.id, ig.token);
  await db.instagramConnection.update({ where: { businessId }, data: { insights: insights as unknown as Prisma.InputJsonObject } });

  // Log unavailable metrics on connect/manual syncs, or when the set changed (not every 6 hours).
  const before = ((previous?.insights as AccountInsights | null)?.unavailable ?? []).map((u) => u.metric).sort().join(",");
  const now = insights.unavailable.map((u) => u.metric).sort().join(",");
  if (insights.unavailable.length && (reason !== "auto" || before !== now)) {
    await logIntegration({
      businessId,
      level: "warning",
      call: "GET /{ig-user}/insights",
      errorCode: "metric_unavailable",
      message: `Not available for this account: ${insights.unavailable.map((u) => `${u.metric} (${u.reason})`).join(", ")}`,
      details: { unavailable: insights.unavailable as unknown as Prisma.InputJsonArray },
    });
  }

  const recent = await db.instagramMedia.findMany({
    where: { businessId, postedAt: { gte: new Date(Date.now() - 30 * DAY) }, NOT: { mediaProductType: "STORY" } },
    orderBy: { postedAt: "desc" },
    take: POST_INSIGHTS_LIMIT,
    select: { igMediaId: true },
  });
  const missing: string[] = [];
  for (const { igMediaId } of recent) {
    const { values, reason: why } = await fetchPostInsights(client, igMediaId, ig.token);
    if (values) {
      await db.instagramMedia.update({ where: { businessId_igMediaId: { businessId, igMediaId } }, data: { insights: values } });
      counts.postInsights += 1;
    } else {
      missing.push(why ?? "unknown");
    }
  }
  if (missing.length && reason !== "auto") {
    await logIntegration({ businessId, level: "warning", call: "GET /{ig-media}/insights", errorCode: "metric_unavailable", message: `Post insights not available for ${missing.length} of ${recent.length} recent posts.`, details: { reasons: [...new Set(missing)] } });
  }
}

async function syncComments(businessId: string, client: ReturnType<typeof graphFor>, ig: { id: string; token: string }, ownUsername: string, counts: SyncResult["counts"]) {
  const posts = await db.instagramMedia.findMany({
    where: { businessId, commentsCount: { gt: 0 } },
    orderBy: { postedAt: "desc" },
    take: COMMENT_POSTS_LIMIT,
    select: { igMediaId: true },
  });
  const fresh: Array<{ igCommentId: string; username: string; text: string; postedAt: Date }> = [];
  for (const { igMediaId } of posts) {
    const comments = await fetchComments(client, igMediaId, ig.token, 50);
    for (const c of comments) {
      const data = { igMediaId, username: c.username, text: c.text, likeCount: c.likeCount, postedAt: c.postedAt, syncedAt: new Date() };
      await db.instagramMediaComment.upsert({ where: { businessId_igCommentId: { businessId, igCommentId: c.igCommentId } }, update: data, create: { businessId, igCommentId: c.igCommentId, ...data } });
      if (c.username && c.username.toLowerCase() !== ownUsername.toLowerCase() && Date.now() - c.postedAt.getTime() < REPLY_DRAFT_MAX_AGE) fresh.push(c);
    }
    counts.comments += comments.length;
  }
  counts.replyDrafts = await draftReplies(businessId, fresh);
}

/** New comments from customers get an AI reply draft for the approval queue (Engagement). */
async function draftReplies(businessId: string, comments: Array<{ igCommentId: string; username: string; text: string }>): Promise<number> {
  if (!comments.length) return 0;
  const existing = new Set((await db.replyDraft.findMany({ where: { businessId, commentId: { in: comments.map((c) => c.igCommentId) } }, select: { commentId: true } })).map((r) => r.commentId));
  const todo = comments.filter((c) => !existing.has(c.igCommentId)).slice(0, REPLY_DRAFTS_PER_SYNC);
  if (!todo.length) return 0;
  const business = await db.business.findUnique({ where: { id: businessId }, select: { name: true, brandVoice: { select: { toneLevel: true, brandWords: true, defaultHashtags: true, whatsappNumber: true, priceQuestionsToWhatsApp: true } } } });
  if (!business) return 0;
  const voice = business.brandVoice;
  let created = 0;
  for (const c of todo) {
    try {
      const draft = await getAIService().draftReply({
        businessName: business.name,
        commentText: c.text,
        commenterUsername: c.username,
        brandVoice: { toneLevel: voice?.toneLevel ?? 50, brandWords: voice?.brandWords ?? [], defaultHashtags: voice?.defaultHashtags ?? [] },
        whatsappNumber: voice?.priceQuestionsToWhatsApp ? (voice.whatsappNumber ?? null) : null,
      });
      await db.replyDraft.create({ data: { businessId, commentId: c.igCommentId, commentText: c.text, commenterUsername: c.username, draftReply: draft.text } });
      created += 1;
    } catch (error) {
      // A duplicate (another sync got there first) or an AI failure: skip this comment.
      if ((error as { code?: string }).code !== "P2002") console.error("[sync] reply draft failed", (error as Error).message);
    }
  }
  return created;
}

/** Runs a full sync after the response when the synced data is older than 6 hours (Meta connections only). */
export async function scheduleAutoSync(businessId: string) {
  const conn = await db.instagramConnection.findUnique({ where: { businessId }, select: { provider: true, status: true, lastSyncAt: true, syncStartedAt: true } });
  if (conn?.provider !== "META" || conn.status !== "CONNECTED") return;
  if (conn.syncStartedAt && Date.now() - conn.syncStartedAt.getTime() < SYNC_STALE_MS) return;
  if (conn.lastSyncAt && Date.now() - conn.lastSyncAt.getTime() < AUTO_SYNC_AFTER_MS) return;
  if (coolingDown(businessId)) return;
  after(() => syncInstagram(businessId, { scope: "full", reason: "auto" }).catch((e) => console.error("[sync] auto sync failed", (e as Error).message)));
}
