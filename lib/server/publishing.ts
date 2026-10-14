import "server-only";
import { after } from "next/server";
import { db } from "@/lib/db";
import { isFeatureEnabled, permissionsFromRows } from "@/lib/permissions";
import { toInstagramJpeg } from "@/lib/services/images/instagram-fit";
import {
  InstagramNotConnectedError,
  InstagramPermissionError,
  InstagramPublishError,
  InstagramRateLimitedError,
  getInstagramService,
} from "@/lib/services/instagram";
import { isPublicHttpsUrl } from "@/lib/services/meta/publish";
import { getStorageService } from "@/lib/services/storage";
import type { FeatureKey } from "@/types";
import { logActivity } from "./activity";
import { ApiError, notFound } from "./http";
import { getInstagramAccount } from "./instagram-account";
import { syncInstagram } from "./instagram-sync";
import { logIntegration } from "./integration-log";
import { coolingDown } from "./meta-client";
import { notify } from "./notifications";

/**
 * Publishing a post to Instagram — single image + caption. Every trigger goes
 * through here:
 *   "Publish now" on a draft or a queued post  → publishDraftNow / publishScheduledNow
 *   the publish cron (app/api/cron/publish)    → publishDuePosts
 *
 * A post is claimed first (ScheduledPost SCHEDULED → PUBLISHING, atomically), so
 * two triggers can never publish the same post. Meta connections get a JPEG copy
 * of the image that fits Instagram's rules (lib/services/images/instagram-fit.ts),
 * stored publicly for Meta to download and deleted afterwards. Mock connections
 * publish through the mock unchanged.
 *
 * Failures never throw out of here: they become a reason code (PublishReason),
 * shown to the user in their language, written to the integration log, and —
 * when final — stored on the ScheduledPost (failureReason) and on the draft
 * (publishError), which goes back to the drafts list so it can be fixed.
 * Token errors (190) already flip the connection to NEEDS_RECONNECT and missing
 * permissions are recorded, both by the Graph client (lib/server/meta-client.ts).
 */

export type PublishReason =
  | "no_image"
  | "caption_too_long"
  | "too_many_hashtags"
  | "image_unreadable"
  | "image_not_public"
  | "image_unreachable"
  | "media_rejected"
  | "processing_timeout"
  | "daily_limit"
  | "uncertain"
  | "not_connected"
  | "permission"
  | "rate_limited"
  | "feature_disabled"
  | "missed_window"
  | "interrupted"
  | "failed";

export type PublishOutcome = { ok: true; scheduledPostId: string; mediaId: string } | { ok: false; scheduledPostId: string; reason: PublishReason; final: boolean };

type Trigger = "manual" | "scheduled";

/** Either feature gives access to the posting queue, so either allows publishing it. */
export const PUBLISH_FEATURES = ["postGenerator.addToQueue", "experiment.scheduleQueue"] as const satisfies readonly FeatureKey[];

const CAPTION_MAX = 2200;
const HASHTAGS_MAX = 30;
/** A PUBLISHING row older than this was interrupted (the function died mid-way). */
const STALE_PUBLISHING_MS = 10 * 60 * 1000;
/** Scheduled posts more than this late (cron down) aren't published at a surprising time. */
const MAX_LATE_MS = 6 * 60 * 60 * 1000;
const RENDITION_PREFIX = "ig-publish";

const CLAIMED_SELECT = {
  id: true,
  businessId: true,
  draftId: true,
  mediaUrl: true,
  draft: { select: { caption: true, imageUrl: true } },
} as const;

type ClaimedPost = { id: string; businessId: string; draftId: string; mediaUrl: string | null; draft: { caption: string; imageUrl: string | null } };

/** Problems we can spot before calling Instagram. */
export function preflight(caption: string, imageUrl: string | null): PublishReason | null {
  if (!imageUrl) return "no_image";
  if (caption.length > CAPTION_MAX) return "caption_too_long";
  if ((caption.match(/(^|\s)#[^\s#]+/gu) ?? []).length > HASHTAGS_MAX) return "too_many_hashtags";
  return null;
}

/** API error for a failed "Publish now" (routes throw it; the UI shows the localized reason). */
export function publishApiError(reason: PublishReason): ApiError {
  if (reason === "not_connected") return new ApiError(409, "instagram_not_connected", "Connect Instagram again to publish.");
  if (reason === "permission") return new ApiError(403, "instagram_permission", "Instagram didn't grant permission to publish.", [{ path: "permission", message: "instagram_content_publish" }]);
  if (reason === "rate_limited") return new ApiError(429, "rate_limited", "Instagram asked us to slow down. Try again in a few minutes.");
  return new ApiError(422, "publish_failed", `Publishing failed (${reason}).`, [{ path: "reason", message: reason }]);
}

// ── Triggers ────────────────────────────────────────────────────────────────

/** "Publish now" on a draft: publishes it at once (a queued draft's scheduled post is used). */
export async function publishDraftNow(businessId: string, draftId: string, userId: string): Promise<PublishOutcome> {
  const draft = await db.postDraft.findFirst({ where: { id: draftId, businessId }, select: { id: true, status: true, imageUrl: true } });
  if (!draft) throw notFound("Draft");
  if (draft.status === "QUEUED") {
    const queued = await db.scheduledPost.findFirst({ where: { draftId, businessId, status: "SCHEDULED" }, select: { id: true }, orderBy: { scheduledFor: "asc" } });
    if (!queued) throw new ApiError(409, "conflict", "This post is already being published.");
    return publishScheduledNow(businessId, queued.id, userId);
  }
  if (draft.status !== "DRAFT") throw new ApiError(409, "conflict", "This draft is already published or rejected.");

  const post = await db.$transaction(async (tx) => {
    const claimed = await tx.postDraft.updateMany({ where: { id: draftId, status: "DRAFT" }, data: { status: "QUEUED", publishError: null } });
    if (claimed.count !== 1) throw new ApiError(409, "conflict", "This draft is already being published.");
    const now = new Date();
    return tx.scheduledPost.create({
      data: { businessId, draftId, scheduledFor: now, status: "PUBLISHING", publishStartedAt: now, mediaUrl: draft.imageUrl },
      select: CLAIMED_SELECT,
    });
  });
  return run(post, { trigger: "manual", userId, fromQueue: false });
}

/** "Publish now" on a queued post. On failure it stays in the queue at its time. */
export async function publishScheduledNow(businessId: string, scheduledPostId: string, userId: string): Promise<PublishOutcome> {
  const post = await claim({ id: scheduledPostId, businessId });
  if (!post) {
    if (!(await db.scheduledPost.count({ where: { id: scheduledPostId, businessId } }))) throw notFound("Scheduled post");
    throw new ApiError(409, "conflict", "Only upcoming posts can be published.");
  }
  return run(post, { trigger: "manual", userId, fromQueue: true });
}

export interface PublishRunSummary {
  recovered: number;
  due: number;
  published: number;
  failed: number;
  retryLater: number;
  skipped: number;
}

/**
 * The publish cron: publishes posts whose time has come, oldest first, until
 * `budgetMs` is used up (the rest wait for the next run). Businesses Meta asked
 * to slow down are skipped this run.
 */
export async function publishDuePosts({ budgetMs = 240_000, limit = 25 } = {}): Promise<PublishRunSummary> {
  const started = Date.now();
  const summary: PublishRunSummary = { recovered: await recoverInterrupted(), due: 0, published: 0, failed: 0, retryLater: 0, skipped: 0 };

  const due = await db.scheduledPost.findMany({
    where: { status: "SCHEDULED", scheduledFor: { lte: new Date() } },
    select: { id: true, businessId: true, scheduledFor: true },
    orderBy: { scheduledFor: "asc" },
    take: limit,
  });
  summary.due = due.length;
  const allowed = new Map<string, boolean>();

  for (const item of due) {
    if (Date.now() - started > budgetMs) break;
    if (!allowed.has(item.businessId)) allowed.set(item.businessId, await canPublish(item.businessId));
    const late = Date.now() - item.scheduledFor.getTime() > MAX_LATE_MS;
    if (allowed.get(item.businessId) && !late && coolingDown(item.businessId)) {
      summary.skipped += 1;
      continue;
    }
    const post = await claim({ id: item.id, businessId: item.businessId });
    if (!post) continue; // taken by "Publish now" meanwhile
    const outcome = !allowed.get(item.businessId)
      ? await fail(post, "feature_disabled", { trigger: "scheduled", fromQueue: true })
      : late
        ? await fail(post, "missed_window", { trigger: "scheduled", fromQueue: true })
        : await run(post, { trigger: "scheduled", fromQueue: true });
    if (outcome.ok) summary.published += 1;
    else if (outcome.final) summary.failed += 1;
    else summary.retryLater += 1;
  }
  return summary;
}

// ── Internals ───────────────────────────────────────────────────────────────

async function canPublish(businessId: string): Promise<boolean> {
  const rows = await db.featurePermission.findMany({ where: { businessId }, select: { featureKey: true, enabled: true } });
  const permissions = permissionsFromRows(rows);
  return PUBLISH_FEATURES.some((key) => isFeatureEnabled(permissions, key));
}

async function claim(where: { id: string; businessId: string }): Promise<ClaimedPost | null> {
  const claimed = await db.scheduledPost.updateMany({ where: { ...where, status: "SCHEDULED" }, data: { status: "PUBLISHING", publishStartedAt: new Date() } });
  if (claimed.count !== 1) return null;
  return db.scheduledPost.findUnique({ where: { id: where.id }, select: CLAIMED_SELECT });
}

/** PUBLISHING rows left behind by a crashed run. We can't know whether Instagram got them. */
async function recoverInterrupted(): Promise<number> {
  const stale = await db.scheduledPost.findMany({
    where: { status: "PUBLISHING", publishStartedAt: { lt: new Date(Date.now() - STALE_PUBLISHING_MS) } },
    select: CLAIMED_SELECT,
  });
  for (const post of stale) await fail(post, "interrupted", { trigger: "scheduled", fromQueue: false });
  return stale.length;
}

interface RunContext {
  trigger: Trigger;
  userId?: string;
  /** The post was in the queue before this attempt (manual failures put it back). */
  fromQueue: boolean;
}

async function run(post: ClaimedPost, ctx: RunContext): Promise<PublishOutcome> {
  const storage = getStorageService();
  let renditionKey: string | null = null;
  let provider: "meta" | "mock" = "mock";
  try {
    const caption = post.draft.caption;
    const imageUrl = post.mediaUrl ?? post.draft.imageUrl;
    const problem = preflight(caption, imageUrl);
    if (problem) return await fail(post, problem, ctx);

    const account = await getInstagramAccount(post.businessId);
    provider = account.provider;
    if (!account.connected) return await fail(post, "not_connected", ctx, { provider });

    let mediaUrl = imageUrl;
    if (account.provider === "meta") {
      // Meta downloads the image itself: it has to be public, and a JPEG in Instagram's shape.
      if (!isPublicHttpsUrl(imageUrl)) return await fail(post, "image_not_public", ctx, { provider });
      const key = storage.keyFromUrl(imageUrl!);
      const original = key ? await storage.read(key) : null;
      if (!original) return await fail(post, "image_unreadable", ctx, { provider });
      let jpeg: Awaited<ReturnType<typeof toInstagramJpeg>>;
      try {
        jpeg = await toInstagramJpeg(original);
      } catch {
        return await fail(post, "image_unreadable", ctx, { provider });
      }
      const saved = await storage.save({ data: jpeg.data, contentType: "image/jpeg", prefix: RENDITION_PREFIX, extension: "jpg" });
      renditionKey = saved.key;
      mediaUrl = saved.url;
    }

    const { mediaId } = await getInstagramService().publishPost(account, { caption, mediaUrl });
    await succeed(post, mediaId, provider, ctx);
    return { ok: true, scheduledPostId: post.id, mediaId };
  } catch (error) {
    const reason = reasonOf(error);
    if (reason === "failed") console.error("[publish] unexpected error", (error as Error)?.message);
    return fail(post, reason, ctx, { provider, detail: error instanceof InstagramPublishError ? error.detail : (error as Error)?.message });
  } finally {
    // Meta has fetched the image by now (the container finished, or the attempt is over).
    if (renditionKey) await storage.delete(renditionKey).catch((e) => console.error("[publish] couldn't delete the publish copy", (e as Error).message));
  }
}

function reasonOf(error: unknown): PublishReason {
  if (error instanceof InstagramPublishError) return error.reason;
  if (error instanceof InstagramNotConnectedError) return "not_connected";
  if (error instanceof InstagramPermissionError) return "permission";
  if (error instanceof InstagramRateLimitedError) return "rate_limited";
  return "failed";
}

async function succeed(post: ClaimedPost, mediaId: string, provider: "meta" | "mock", ctx: RunContext) {
  await db.$transaction(async (tx) => {
    await tx.scheduledPost.update({ where: { id: post.id }, data: { status: "PUBLISHED", publishedMediaId: mediaId, publishedAt: new Date(), failureReason: null } });
    await tx.postDraft.update({ where: { id: post.draftId }, data: { status: "PUBLISHED", publishError: null } });
    await logActivity({ businessId: post.businessId, userId: ctx.userId ?? null, action: "post.published", details: { draftId: post.draftId, scheduledPostId: post.id, trigger: ctx.trigger } }, tx);
  });
  await logIntegration({
    businessId: post.businessId,
    provider,
    level: "info",
    call: "publish post",
    message: `Post published to Instagram (${ctx.trigger === "manual" ? "Publish now" : "scheduled"}).`,
    details: { scheduledPostId: post.id, draftId: post.draftId, mediaId, trigger: ctx.trigger },
  });
  if (ctx.trigger === "scheduled") await notify({ businessId: post.businessId, type: "post_published" });
  // Pull the new post (and the profile's post count) into the app soon.
  if (provider === "meta" && !coolingDown(post.businessId)) {
    after(() => syncInstagram(post.businessId, { scope: "full", reason: "auto" }).catch((e) => console.error("[publish] sync after publishing failed", (e as Error).message)));
  }
}

/** English summary for the integration log (the UI shows its own localized text). */
const LOG_TEXT: Record<PublishReason, string> = {
  no_image: "The post has no image; Instagram requires one.",
  caption_too_long: `The caption is longer than ${CAPTION_MAX} characters.`,
  too_many_hashtags: `The caption has more than ${HASHTAGS_MAX} hashtags.`,
  image_unreadable: "The post's image couldn't be read or converted to JPEG.",
  image_not_public: "The image isn't at a public HTTPS URL (STORAGE_PROVIDER must be vercel-blob).",
  image_unreachable: "Meta couldn't download the image.",
  media_rejected: "Instagram rejected the image or caption.",
  processing_timeout: "Instagram didn't finish processing the image in time.",
  daily_limit: "The account reached Instagram's limit of published posts for 24 hours.",
  uncertain: "The publish call got no answer; the post may or may not be on Instagram.",
  not_connected: "Instagram isn't connected (or the token expired / was revoked).",
  permission: "The instagram_content_publish permission wasn't granted.",
  rate_limited: "Meta rate limit; will retry later.",
  feature_disabled: "Publishing features are turned off for this business.",
  missed_window: "The scheduled time passed more than 6 hours ago; not published late.",
  interrupted: "A publish attempt was interrupted; check Instagram before retrying.",
  failed: "Publishing failed unexpectedly.",
};

/** Retried by the next cron run instead of failing the scheduled post. */
const RETRY_LATER: ReadonlySet<PublishReason> = new Set(["rate_limited", "processing_timeout"]);

async function fail(post: ClaimedPost, reason: PublishReason, ctx: RunContext, extra: { provider?: "meta" | "mock"; detail?: string } = {}): Promise<PublishOutcome> {
  // A queued post whose "Publish now" failed keeps its slot; so does a scheduled one hitting a temporary limit.
  const backToQueue = ctx.fromQueue && (ctx.trigger === "manual" || RETRY_LATER.has(reason)) && reason !== "uncertain" && reason !== "interrupted";
  try {
    if (backToQueue) {
      await db.scheduledPost.update({ where: { id: post.id }, data: { status: "SCHEDULED", publishStartedAt: null } });
    } else {
      await db.$transaction(async (tx) => {
        await tx.scheduledPost.update({ where: { id: post.id }, data: { status: "FAILED", failureReason: reason } });
        const stillQueued = await tx.scheduledPost.count({ where: { draftId: post.draftId, status: { in: ["SCHEDULED", "PUBLISHING"] } } });
        await tx.postDraft.update({ where: { id: post.draftId }, data: { publishError: reason, ...(stillQueued === 0 && { status: "DRAFT" }) } });
        await logActivity({ businessId: post.businessId, userId: ctx.userId ?? null, action: "post.publish_failed", details: { draftId: post.draftId, scheduledPostId: post.id, reason, trigger: ctx.trigger } }, tx);
      });
    }
  } catch (error) {
    console.error("[publish] couldn't record the failure", (error as Error).message);
  }
  // A scheduled post that won't be retried: tell the owner (a manual "Publish now" shows its result on screen).
  if (ctx.trigger === "scheduled" && !backToQueue) await notify({ businessId: post.businessId, type: "post_failed", params: { reason } });
  await logIntegration({
    businessId: post.businessId,
    provider: extra.provider ?? "meta",
    level: RETRY_LATER.has(reason) || reason === "no_image" ? "warning" : "error",
    call: "publish post",
    errorCode: reason,
    message: extra.detail ? `${LOG_TEXT[reason]} ${extra.detail}` : LOG_TEXT[reason],
    details: { scheduledPostId: post.id, draftId: post.draftId, trigger: ctx.trigger, reason, outcome: backToQueue ? "kept_in_queue" : "failed" },
  });
  return { ok: false, scheduledPostId: post.id, reason, final: !backToQueue };
}
