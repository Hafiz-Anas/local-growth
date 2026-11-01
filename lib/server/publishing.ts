import "server-only";
import { after } from "next/server";
import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { isFeatureEnabled, permissionsFromRows } from "@/lib/permissions";
import {
  PROCESSING_RECHECK_MS,
  PUBLISH_LEASE_MS,
  afterFailure,
  isMissed,
  nextStep,
  onContainerStatus,
  type PublishReason,
} from "@/lib/publishing/job";
import { toInstagramJpeg } from "@/lib/services/images/instagram-fit";
import {
  InstagramNotConnectedError,
  InstagramPermissionError,
  InstagramPublishError,
  InstagramRateLimitedError,
  getInstagramService,
  type InstagramAccount,
} from "@/lib/services/instagram";
import { CAROUSEL_MAX, captionProblem, isPublicHttpsUrl } from "@/lib/services/meta/publish";
import { getStorageService } from "@/lib/services/storage";
import type { FeatureKey } from "@/types";
import { logActivity } from "./activity";
import { samplePhotoPath } from "./gallery";
import { ApiError, notFound } from "./http";
import { fetchImage } from "./image-fetch";
import { getInstagramAccount } from "./instagram-account";
import { syncInstagram } from "./instagram-sync";
import { logIntegration } from "./integration-log";
import { coolingDown } from "./meta-client";
import { notify } from "./notifications";

export type { PublishReason } from "@/lib/publishing/job";

/**
 * Publishing to Instagram (BE3): a durable job per post, worked through by the publish cron.
 *
 *   approve   approveDraft (Gallery / AI chat "Schedule" or "Post now"), publishDraftNow (old Post Generator)
 *             → the photos are frozen as Instagram-ready JPEGs in our storage, the job (ScheduledPost) records
 *               the Instagram account it's for, the draft is Queued. "Post now" starts the job straight after
 *               the request (after()); the cron picks it up if that dies, so the browser can be closed.
 *   deliver   runJob, from the cron (publishDuePosts, every minute) or "Post now": one job at a time under a
 *             lease, step by step — carousel children → container → status → media_publish → Posted — saving
 *             every id Instagram returns before the next step, so the next run resumes where this one stopped.
 *   protect   media_publish is the only call that can make a post. publishCallAt is saved before it is sent;
 *             from then on the job checks the container first: PUBLISHED → Posted (the media id is looked up),
 *             FINISHED → not live, safe to publish, anything else → never published. A post is never sent twice.
 *   recover   limited retries with backoff, waiting (not failing) for a reconnect or the daily limit for up to
 *             6 hours, then Failed with a reason the owner sees, and Reschedule / Cancel (reschedulePost, cancelPost).
 *
 * The rules (what's retried, held, final, what a container status means) are pure in lib/publishing/job.ts.
 * Old Post Generator jobs (no frozen photos) get theirs converted when publishing starts.
 */

/** Any of these gives access to publishing (the Gallery / AI tab, or the old queue). */
export const PUBLISH_FEATURES = ["gallery.publishing", "postGenerator.addToQueue", "experiment.scheduleQueue"] as const satisfies readonly FeatureKey[];

/** Frozen copies live under this storage prefix (public: Meta downloads them). */
const PUBLISH_PREFIX = "ig-publish";
/** How long one run may keep working on a job (polls included) before handing it to the next run. */
const STEP_BUDGET_MS = 45_000;
/** "Publish now" from the old screens waits for the result inside the request, up to this long. */
const INLINE_BUDGET_MS = 90_000;
/** Quick re-checks of a processing container inside one run before handing it to the next run. */
const INLINE_POLLS = 4;
const POLL_INTERVAL_MS = 3_000;

export type PublishOutcome =
  | { ok: true; jobId: string; mediaId: string | null }
  | { ok: false; jobId: string; reason: PublishReason; final: boolean }
  | { ok: false; jobId: string; pending: true };

/** A problem with the post itself, found before or while preparing it. */
class PublishProblem extends Error {
  constructor(
    readonly reason: PublishReason,
    readonly detail = "",
  ) {
    super(reason);
  }
}

/** API error for a refused approval or a failed "Publish now" (the UI shows the localized reason). */
export function publishApiError(reason: PublishReason): ApiError {
  if (reason === "not_connected") return new ApiError(409, "instagram_not_connected", "Connect Instagram again to publish.");
  if (reason === "permission") return new ApiError(403, "instagram_permission", "Instagram didn't grant permission to publish.", [{ path: "permission", message: "instagram_content_publish" }]);
  if (reason === "rate_limited") return new ApiError(429, "rate_limited", "Instagram asked us to slow down. Try again in a few minutes.");
  return new ApiError(422, "publish_failed", `Publishing failed (${reason}).`, [{ path: "reason", message: reason }]);
}

// ── Approve ─────────────────────────────────────────────────────────────────

interface MediaSource {
  /** Our stored file, a bundled sample image, or null for an Instagram post (asked for a current link). */
  url: string | null;
  igMediaId: string | null;
}

/**
 * Instagram-ready JPEG copies of the photos, in order, in our (public) storage: the cover in its own shape
 * clamped to 4:5–1.91:1, a carousel's other photos cropped to the cover's shape. Instagram posts are
 * downloaded now (their links expire). Mock connections keep a photo's own link when it can't be read
 * (nothing is downloaded by the mock). Throws PublishProblem; nothing is left behind on failure.
 */
async function freezeMedia(account: InstagramAccount, sources: MediaSource[]): Promise<{ urls: string[]; keys: string[] }> {
  const storage = getStorageService();
  const ig = getInstagramService();
  const urls: string[] = [];
  const keys: string[] = [];
  let ratio: number | undefined;
  try {
    for (const source of sources) {
      const link = source.igMediaId ? await ig.getMediaImageUrl(account, source.igMediaId).catch(() => null) : source.url;
      const original = await fetchImage(link);
      let jpeg: Awaited<ReturnType<typeof toInstagramJpeg>> | null = null;
      if (original) jpeg = await toInstagramJpeg(original, { ratio }).catch(() => null);
      if (!jpeg) {
        if (account.provider === "mock" && link) {
          urls.push(link);
          keys.push("");
          continue;
        }
        throw new PublishProblem("image_unreadable");
      }
      ratio ??= jpeg.width / jpeg.height;
      const saved = await storage.save({ data: jpeg.data, contentType: "image/jpeg", prefix: PUBLISH_PREFIX, extension: "jpg" });
      urls.push(saved.url);
      keys.push(saved.key);
      // Meta downloads the image itself: it has to be public (STORAGE_PROVIDER=vercel-blob).
      if (account.provider === "meta" && !isPublicHttpsUrl(saved.url)) throw new PublishProblem("image_not_public");
    }
    return { urls, keys };
  } catch (error) {
    await deleteMedia(keys);
    throw error instanceof PublishProblem ? error : new PublishProblem("image_unreadable", (error as Error)?.message);
  }
}

async function deleteMedia(keys: string[]) {
  const storage = getStorageService();
  for (const key of keys) if (key) await storage.delete(key).catch((e) => console.error("[publish] couldn't delete a publish copy", (e as Error).message));
}

/** Refuses up front what would fail anyway: no connection, or the publishing permission missing. */
async function assertCanPublishTo(businessId: string, account: InstagramAccount) {
  if (!account.connected) throw publishApiError("not_connected");
  if (account.provider === "meta") {
    const conn = await db.instagramConnection.findUnique({ where: { businessId }, select: { missingPermissions: true } });
    if (conn?.missingPermissions.includes("instagram_content_publish")) throw publishApiError("permission");
  }
}

/** The language a Gallery / AI chat post goes out in: the chosen one, else English for English-only accounts, else Arabic when there is one. */
async function postLanguage(businessId: string, draft: { captionEn: string | null; captionAr: string | null }, chosen?: "en" | "ar"): Promise<"en" | "ar"> {
  if (chosen) return chosen;
  const { languages } = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { languages: true } });
  if (languages.length === 1 && languages[0] === "en") return "en";
  return draft.captionAr?.trim() ? "ar" : "en";
}

const captionIn = (draft: { captionEn: string | null; captionAr: string | null; caption: string }, language: "en" | "ar") =>
  (language === "en" ? draft.captionEn || draft.captionAr : draft.captionAr || draft.captionEn) || draft.caption;

/**
 * Approves a Gallery / AI chat draft for publishing: at `at`, or now (null). The job records the photos (frozen),
 * the Instagram account and who approved it; the caption can still be edited until publishing starts.
 * Returns the job's id. Refusals are API errors (not connected, permission, caption/photo problems, already queued).
 */
export async function approveDraft(businessId: string, userId: string, draftId: string, input: { at: Date | null; language?: "en" | "ar" }): Promise<string> {
  const draft = await db.postDraft.findFirst({
    where: { id: draftId, businessId, origin: { in: ["AI_CHAT", "GALLERY"] } },
    select: {
      status: true,
      caption: true,
      captionEn: true,
      captionAr: true,
      photos: { orderBy: { position: "asc" }, select: { photo: { select: { url: true, igMediaId: true, sampleKey: true } } } },
    },
  });
  if (!draft) throw notFound("Draft");
  if (draft.status === "QUEUED") throw new ApiError(409, "already_scheduled", "This post is already scheduled.");
  if (draft.status !== "DRAFT") throw new ApiError(409, "conflict", "This post is already published.");

  const language = await postLanguage(businessId, draft, input.language);
  const caption = captionIn(draft, language);
  const problem = captionProblem(caption);
  if (problem) throw publishApiError(problem);
  if (!draft.photos.length) throw publishApiError("no_image");
  if (draft.photos.length > CAROUSEL_MAX) throw publishApiError("too_many_photos");

  const account = await getInstagramAccount(businessId);
  await assertCanPublishTo(businessId, account);

  let media: { urls: string[]; keys: string[] };
  try {
    media = await freezeMedia(
      account,
      draft.photos.map(({ photo }) => ({ url: photo.sampleKey ? samplePhotoPath(photo.sampleKey) : photo.url, igMediaId: photo.igMediaId })),
    );
  } catch (error) {
    throw error instanceof PublishProblem ? publishApiError(error.reason) : error;
  }

  const now = new Date();
  try {
    const job = await db.$transaction(async (tx) => {
      const claimed = await tx.postDraft.updateMany({ where: { id: draftId, status: "DRAFT" }, data: { status: "QUEUED", publishError: null, caption, language } });
      if (claimed.count !== 1) throw new ApiError(409, "already_scheduled", "This post is already scheduled.");
      const created = await tx.scheduledPost.create({
        data: {
          businessId,
          draftId,
          scheduledFor: input.at ?? now,
          format: media.urls.length > 1 ? "CAROUSEL" : "IMAGE",
          mediaUrl: media.urls[0],
          mediaUrls: media.urls,
          mediaKeys: media.keys,
          igUserId: account.igUserId,
          approvedBy: userId,
          approvedAt: now,
        },
        select: { id: true },
      });
      await logActivity(
        { businessId, userId, action: "post.approved", details: { draftId, scheduledPostId: created.id, scheduledFor: (input.at ?? now).toISOString(), photos: media.urls.length, now: !input.at } },
        tx,
      );
      return created;
    });
    if (!input.at) startSoon(job.id);
    return job.id;
  } catch (error) {
    await deleteMedia(media.keys);
    throw error;
  }
}

/** Runs a job right after the response ("Post now"); the cron continues it if this dies. */
function startSoon(jobId: string) {
  after(() => runJob(jobId, { trigger: "now" }).then(() => undefined, (e) => console.error("[publish] post now failed to run", (e as Error)?.message)));
}

/**
 * Moves an upcoming post to `at` (null: now), or tries a failed one again. A failed job that had containers
 * checks them first (verifyFirst): if Instagram did publish it, it becomes Posted instead of going out twice.
 */
export async function reschedulePost(businessId: string, userId: string, jobId: string, at: Date | null): Promise<void> {
  const job = await db.scheduledPost.findFirst({ where: { id: jobId, businessId }, select: { status: true, draftId: true, containerId: true, publishCallAt: true } });
  if (!job) throw notFound("Scheduled post");
  const scheduledFor = at ?? new Date();
  const reset = { scheduledFor, attempts: 0, nextAttemptAt: null, waitingReason: null, leaseUntil: null } satisfies Prisma.ScheduledPostUpdateManyMutationInput;

  if (job.status === "SCHEDULED") {
    const { count } = await db.scheduledPost.updateMany({ where: { id: jobId, status: "SCHEDULED" }, data: reset });
    if (count !== 1) throw new ApiError(409, "publish_started", "Publishing has already started.");
  } else if (job.status === "FAILED") {
    await db.$transaction(async (tx) => {
      const active = await tx.scheduledPost.count({ where: { draftId: job.draftId, status: { in: ["SCHEDULED", "PUBLISHING"] } } });
      if (active) throw new ApiError(409, "already_scheduled", "This post is already scheduled.");
      const { count } = await tx.scheduledPost.updateMany({
        where: { id: jobId, status: "FAILED" },
        data: { ...reset, status: "SCHEDULED", failureReason: null, caption: null, verifyFirst: Boolean(job.containerId || job.publishCallAt) },
      });
      if (count !== 1) throw new ApiError(409, "conflict", "This post changed meanwhile. Reload and try again.");
      await tx.postDraft.update({ where: { id: job.draftId }, data: { status: "QUEUED", publishError: null } });
    });
  } else {
    throw new ApiError(409, job.status === "PUBLISHING" ? "publish_started" : "conflict", "Only scheduled or failed posts can be rescheduled.");
  }
  await logActivity({ businessId, userId, action: "post.rescheduled", details: { scheduledPostId: jobId, scheduledFor: scheduledFor.toISOString(), now: !at, retry: job.status === "FAILED" } });
  if (!at) startSoon(jobId);
}

/** Cancels an upcoming post (or dismisses a failed one): its draft goes back to the drafts. Not once publishing started. */
export async function cancelPost(businessId: string, userId: string, jobId: string): Promise<void> {
  const job = await db.scheduledPost.findFirst({ where: { id: jobId, businessId }, select: { status: true, draftId: true, mediaKeys: true } });
  if (!job) throw notFound("Scheduled post");
  if (job.status === "PUBLISHING") throw new ApiError(409, "publish_started", "Publishing has already started; it can't be cancelled now.");
  if (job.status !== "SCHEDULED" && job.status !== "FAILED") throw new ApiError(409, "conflict", "Only upcoming or failed posts can be cancelled.");
  await db.$transaction(async (tx) => {
    const { count } = await tx.scheduledPost.updateMany({ where: { id: jobId, status: job.status }, data: { status: "CANCELLED", cancelledBy: userId, cancelledAt: new Date(), leaseUntil: null } });
    if (count !== 1) throw new ApiError(409, "publish_started", "Publishing has already started; it can't be cancelled now.");
    const stillActive = await tx.scheduledPost.count({ where: { draftId: job.draftId, status: { in: ["SCHEDULED", "PUBLISHING"] } } });
    if (!stillActive) await tx.postDraft.updateMany({ where: { id: job.draftId, status: "QUEUED" }, data: { status: "DRAFT" } });
    await logActivity({ businessId, userId, action: "post.cancelled", details: { scheduledPostId: jobId } }, tx);
  });
  await deleteMedia(job.mediaKeys);
}

/**
 * Inside a transaction that edits a draft: locks its jobs and refuses once publishing has started (the caption
 * is locked from then on). A job claimed by the cron waits for this transaction, so it sends the saved caption.
 */
export async function assertDraftEditable(tx: Prisma.TransactionClient, draftId: string): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ status: string }>>`SELECT status::text AS status FROM "ScheduledPost" WHERE "draftId" = ${draftId} FOR UPDATE`;
  if (rows.some((r) => r.status === "PUBLISHING")) throw new ApiError(409, "publish_started", "Publishing has started; the post can't be changed now.");
  if (rows.some((r) => r.status === "PUBLISHED")) throw new ApiError(409, "conflict", "This post is already on Instagram.");
}

// ── Old Post Generator / queue triggers (wait for the result inside the request) ──

/** "Publish now" on an old Post Generator draft: a job at once, run inside the request. */
export async function publishDraftNow(businessId: string, draftId: string, userId: string): Promise<PublishOutcome> {
  const draft = await db.postDraft.findFirst({ where: { id: draftId, businessId }, select: { id: true, status: true, imageUrl: true, caption: true } });
  if (!draft) throw notFound("Draft");
  if (draft.status === "QUEUED") {
    const queued = await db.scheduledPost.findFirst({ where: { draftId, businessId, status: "SCHEDULED" }, select: { id: true }, orderBy: { scheduledFor: "asc" } });
    if (!queued) throw new ApiError(409, "conflict", "This post is already being published.");
    return publishScheduledNow(businessId, queued.id, userId);
  }
  if (draft.status !== "DRAFT") throw new ApiError(409, "conflict", "This draft is already published or rejected.");
  const problem = !draft.imageUrl ? "no_image" : captionProblem(draft.caption);
  if (problem) throw publishApiError(problem);
  const account = await getInstagramAccount(businessId);
  await assertCanPublishTo(businessId, account);

  const job = await db.$transaction(async (tx) => {
    const claimed = await tx.postDraft.updateMany({ where: { id: draftId, status: "DRAFT" }, data: { status: "QUEUED", publishError: null } });
    if (claimed.count !== 1) throw new ApiError(409, "conflict", "This draft is already being published.");
    return tx.scheduledPost.create({ data: { businessId, draftId, scheduledFor: new Date(), mediaUrl: draft.imageUrl, igUserId: account.igUserId, approvedBy: userId, approvedAt: new Date() }, select: { id: true } });
  });
  return (await runJob(job.id, { trigger: "manual", userId, budgetMs: INLINE_BUDGET_MS })) ?? { ok: false, jobId: job.id, pending: true };
}

/** "Publish now" on a queued post: due now, run inside the request. On failure it follows the normal rules. */
export async function publishScheduledNow(businessId: string, jobId: string, userId: string): Promise<PublishOutcome> {
  const { count } = await db.scheduledPost.updateMany({ where: { id: jobId, businessId, status: "SCHEDULED" }, data: { scheduledFor: new Date(), nextAttemptAt: null, waitingReason: null } });
  if (count !== 1) {
    if (!(await db.scheduledPost.count({ where: { id: jobId, businessId } }))) throw notFound("Scheduled post");
    throw new ApiError(409, "conflict", "Only upcoming posts can be published.");
  }
  // Null: the cron took it a moment ago; it shows as Publishing.
  return (await runJob(jobId, { trigger: "manual", userId, budgetMs: INLINE_BUDGET_MS })) ?? { ok: false, jobId, pending: true };
}

// ── Deliver ─────────────────────────────────────────────────────────────────

export interface PublishRunSummary {
  due: number;
  published: number;
  failed: number;
  retryLater: number;
  skipped: number;
}

/** Jobs a run may take: due and not waiting, and not held by a live worker. */
function runnableWhere(now: Date): Prisma.ScheduledPostWhereInput {
  return {
    AND: [
      { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
      { OR: [{ status: "SCHEDULED", scheduledFor: { lte: now } }, { status: "PUBLISHING", OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] }] },
    ],
  };
}

/**
 * The publish cron (every minute): continues every runnable job, oldest first, until `budgetMs` is used up.
 * Businesses Meta asked to slow down wait for a later run.
 */
export async function publishDuePosts({ budgetMs = 240_000, limit = 50 } = {}): Promise<PublishRunSummary> {
  const started = Date.now();
  const due = await db.scheduledPost.findMany({ where: runnableWhere(new Date()), select: { id: true, businessId: true }, orderBy: { scheduledFor: "asc" }, take: limit });
  const summary: PublishRunSummary = { due: due.length, published: 0, failed: 0, retryLater: 0, skipped: 0 };
  for (const item of due) {
    if (Date.now() - started > budgetMs) break;
    if (coolingDown(item.businessId)) {
      summary.skipped += 1;
      continue;
    }
    const outcome = await runJob(item.id, { trigger: "scheduled", budgetMs: Math.min(STEP_BUDGET_MS, budgetMs - (Date.now() - started)) });
    if (!outcome) continue; // taken by another run or "Post now" meanwhile
    if (outcome.ok) summary.published += 1;
    else if ("pending" in outcome || !outcome.final) summary.retryLater += 1;
    else summary.failed += 1;
  }
  return summary;
}

const JOB_SELECT = {
  id: true,
  businessId: true,
  draftId: true,
  status: true,
  scheduledFor: true,
  format: true,
  mediaUrl: true,
  mediaUrls: true,
  mediaKeys: true,
  igUserId: true,
  caption: true,
  containerId: true,
  childContainerIds: true,
  publishCallAt: true,
  verifyFirst: true,
  attempts: true,
  publishStartedAt: true,
  draft: { select: { caption: true, imageUrl: true } },
} satisfies Prisma.ScheduledPostSelect;

type Job = Prisma.ScheduledPostGetPayload<{ select: typeof JOB_SELECT }>;

type Trigger = "scheduled" | "now" | "manual";

interface RunContext {
  trigger: Trigger;
  userId?: string;
  budgetMs?: number;
}

/** Takes the job for this worker (lease); null when it isn't runnable or another worker has it. */
async function claim(id: string): Promise<Job | null> {
  const now = new Date();
  const { count } = await db.scheduledPost.updateMany({
    where: { id, ...runnableWhere(now) },
    data: { status: "PUBLISHING", leaseUntil: new Date(now.getTime() + PUBLISH_LEASE_MS), nextAttemptAt: null },
  });
  if (count !== 1) return null;
  return db.scheduledPost.findUnique({ where: { id }, select: JOB_SELECT });
}

/**
 * Works on one job until it's Posted, Failed, waiting, or this run's budget is used. Null when the job
 * wasn't runnable (not due, cancelled, or held by another worker).
 */
export async function runJob(jobId: string, ctx: RunContext): Promise<PublishOutcome | null> {
  const claimed = await claim(jobId);
  if (!claimed) return null;
  let job: Job = claimed;
  const started = Date.now();
  const budget = ctx.budgetMs ?? STEP_BUDGET_MS;
  const ig = getInstagramService();
  let provider: "meta" | "mock" = "mock";

  /** Saves progress (Instagram's ids) at once, before the next call. */
  const save = async (data: Prisma.ScheduledPostUpdateInput) => {
    job = await db.scheduledPost.update({ where: { id: job.id }, data, select: JOB_SELECT });
  };

  try {
    const now = new Date();
    const publishCalled = Boolean(job.publishCallAt);
    const account = await getInstagramAccount(job.businessId);
    provider = account.provider;
    if (!publishCalled && !(await canPublish(job.businessId))) return await final(job, "feature_disabled", ctx, { provider });
    // Disconnected: held up to 6 hours late, then failed as not connected (reconnecting is the owner's fix).
    if (!account.connected) return await failure(job, "not_connected", ctx, { provider });
    if (isMissed({ scheduledFor: job.scheduledFor, attempts: job.attempts, publishCalled }, now) && !job.containerId) return await final(job, "missed_window", ctx, { provider });
    if (job.igUserId && account.igUserId && job.igUserId !== account.igUserId) return await final(job, "account_changed", ctx, { provider });

    // The caption as it is when publishing starts; the draft can't be edited from here on.
    if (job.caption === null) await save({ caption: job.draft.caption, publishStartedAt: job.publishStartedAt ?? now });
    const caption = job.caption!;
    if (!publishCalled && !job.containerId) {
      const problem = captionProblem(caption);
      if (problem) return await final(job, problem, ctx, { provider });
    }

    // Old Post Generator jobs: their image is converted now.
    if (!job.mediaUrls.length) {
      const source = job.mediaUrl ?? job.draft.imageUrl;
      if (!source) return await final(job, "no_image", ctx, { provider });
      const media = await freezeMedia(account, [{ url: source, igMediaId: null }]);
      await save({ mediaUrls: media.urls, mediaKeys: media.keys, format: "IMAGE" });
    }

    let polls = 0;
    while (Date.now() - started < budget) {
      const step = nextStep({
        format: job.format,
        photos: job.mediaUrls.length,
        childContainerIds: job.childContainerIds,
        containerId: job.containerId,
        publishCalled: Boolean(job.publishCallAt),
        verifyFirst: job.verifyFirst,
      });

      if (step === "create_child") {
        const id = await ig.createPostContainer(account, { imageUrl: job.mediaUrls[job.childContainerIds.length], carouselItem: true });
        await save({ childContainerIds: { push: id } });
        continue;
      }

      if (step === "create_container") {
        // The daily publishing limit, checked before the post's container (the step that leads to a post).
        const limit = await ig.getPublishingLimit(account);
        if (limit && limit.used >= limit.total) return await failure(job, "daily_limit", ctx, { provider });
        const id =
          job.format === "CAROUSEL"
            ? await ig.createCarouselContainer(account, { childIds: job.childContainerIds, caption })
            : await ig.createPostContainer(account, { imageUrl: job.mediaUrls[0], caption });
        await save({ containerId: id, publishStartedAt: new Date(), verifyFirst: false });
        continue;
      }

      // step === "check": what the container says decides everything (the duplicate protection).
      const status = await ig.getContainerStatus(account, job.containerId!);
      const decision = onContainerStatus(status.code, { fresh: !job.verifyFirst, processingSince: job.publishStartedAt, now: new Date() });

      if (decision.kind === "posted") return await posted(job, account, caption, null, ctx);
      if (decision.kind === "fail") return await final(job, decision.reason, ctx, { provider, detail: status.detail });
      if (decision.kind === "restart") {
        // Never published (expired, or an old container of a rescheduled job): new containers are safe.
        await save({ containerId: null, childContainerIds: [], publishCallAt: null, verifyFirst: false });
        continue;
      }
      if (decision.kind === "wait") {
        if (polls++ < INLINE_POLLS && Date.now() - started + POLL_INTERVAL_MS < budget) {
          await sleep(POLL_INTERVAL_MS);
          continue;
        }
        await release(job, new Date(Date.now() + PROCESSING_RECHECK_MS), "processing");
        return { ok: false, jobId: job.id, pending: true };
      }

      // decision.kind === "publish": saved before the call, so a crash or an unclear answer is checked, not repeated.
      await save({ publishCallAt: new Date() });
      const mediaId = await ig.publishContainer(account, job.containerId!);
      return await posted(job, account, caption, mediaId, ctx);
    }
    await release(job, null, null);
    return { ok: false, jobId: job.id, pending: true };
  } catch (error) {
    const reason = reasonOf(error);
    if (error instanceof PublishProblem && reason === "image_unreadable") return final(job, reason, ctx, { provider, detail: error.detail });
    if (reason === "failed") console.error("[publish] unexpected error", (error as Error)?.message);
    return failure(job, reason, ctx, { provider, detail: error instanceof InstagramPublishError ? error.detail : (error as Error)?.message });
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function canPublish(businessId: string): Promise<boolean> {
  const rows = await db.featurePermission.findMany({ where: { businessId }, select: { featureKey: true, enabled: true } });
  const permissions = permissionsFromRows(rows);
  return PUBLISH_FEATURES.some((key) => isFeatureEnabled(permissions, key));
}

/** Hands the job back for a later run (still processing, or this run's time is up). */
async function release(job: Job, nextAttemptAt: Date | null, waitingReason: string | null) {
  await db.scheduledPost.update({ where: { id: job.id }, data: { leaseUntil: null, nextAttemptAt, waitingReason } });
}

function reasonOf(error: unknown): PublishReason {
  if (error instanceof PublishProblem) return error.reason;
  if (error instanceof InstagramPublishError) return error.reason;
  if (error instanceof InstagramNotConnectedError) return "not_connected";
  if (error instanceof InstagramPermissionError) return "permission";
  if (error instanceof InstagramRateLimitedError) return "rate_limited";
  return "failed";
}

/** The job is on Instagram: record the media id (looked up when the answer was unclear) and its link. */
async function posted(job: Job, account: InstagramAccount, caption: string, mediaId: string | null, ctx: RunContext): Promise<PublishOutcome> {
  const ig = getInstagramService();
  let id = mediaId;
  let permalink: string | null = null;
  if (!id) {
    const found = await ig.findPublishedMedia(account, { caption, since: job.publishCallAt ?? job.publishStartedAt ?? job.scheduledFor }).catch(() => null);
    id = found?.mediaId ?? null;
    permalink = found?.permalink ?? null;
  }
  if (id && !permalink) permalink = await ig.getPermalink(account, id);

  await db.$transaction(async (tx) => {
    await tx.scheduledPost.update({
      where: { id: job.id },
      data: { status: "PUBLISHED", publishedMediaId: id, permalink, publishedAt: new Date(), failureReason: null, waitingReason: null, leaseUntil: null, nextAttemptAt: null },
    });
    await tx.postDraft.update({ where: { id: job.draftId }, data: { status: "PUBLISHED", publishError: null } });
    await logActivity({ businessId: job.businessId, userId: ctx.userId ?? null, action: "post.published", details: { draftId: job.draftId, scheduledPostId: job.id, mediaId: id, trigger: ctx.trigger, photos: job.mediaUrls.length } }, tx);
  });
  await logIntegration({
    businessId: job.businessId,
    provider: account.provider,
    level: "info",
    call: "publish post",
    message: `Post published to Instagram (${ctx.trigger === "scheduled" ? "scheduled" : "Post now"}${job.format === "CAROUSEL" ? `, carousel of ${job.mediaUrls.length}` : ""}).${id ? "" : " Its media id wasn't found yet; the next sync shows the post."}`,
    details: { scheduledPostId: job.id, draftId: job.draftId, mediaId: id, containerId: job.containerId, trigger: ctx.trigger },
  });
  if (ctx.trigger !== "manual") await notify({ businessId: job.businessId, type: "post_published" });
  // Meta has the images; the copies aren't needed any more.
  await deleteMedia(job.mediaKeys);
  if (account.provider === "meta" && !coolingDown(job.businessId)) {
    after(() => syncInstagram(job.businessId, { scope: "full", reason: "auto" }).catch((e) => console.error("[publish] sync after publishing failed", (e as Error).message)));
  }
  return { ok: true, jobId: job.id, mediaId: id };
}

/** English summary for the integration log (the UI shows its own localized text). */
const LOG_TEXT: Record<PublishReason, string> = {
  no_image: "The post has no image; Instagram requires one.",
  too_many_photos: `A carousel can have at most ${CAROUSEL_MAX} photos.`,
  caption_too_long: "The caption is longer than 2,200 characters.",
  too_many_hashtags: "The caption has more than 30 hashtags.",
  too_many_mentions: "The caption has more than 20 @mentions.",
  image_unreadable: "A photo couldn't be read or converted to JPEG.",
  image_not_public: "The image isn't at a public HTTPS URL (STORAGE_PROVIDER must be vercel-blob).",
  image_unreachable: "Meta couldn't download the image.",
  media_rejected: "Instagram rejected the image or caption.",
  processing_timeout: "Instagram didn't finish processing the image in time.",
  daily_limit: "The account reached Instagram's limit of published posts for 24 hours.",
  uncertain: "The publish call got no answer; the container is checked before anything is sent again.",
  network: "No answer from Instagram; will retry.",
  not_connected: "Instagram isn't connected (or the token expired / was revoked).",
  account_changed: "A different Instagram account is connected now than when the post was approved.",
  permission: "The instagram_content_publish permission wasn't granted.",
  rate_limited: "Meta rate limit; will retry later.",
  feature_disabled: "Publishing features are turned off for this business.",
  missed_window: "The scheduled time passed more than 6 hours ago; not published late.",
  interrupted: "A publish attempt was interrupted; Instagram is checked before retrying.",
  failed: "Publishing failed unexpectedly.",
};

/** A step failed: retry later, wait (reconnect / daily limit), or fail for good — lib/publishing/job.ts decides. */
async function failure(job: Job, reason: PublishReason, ctx: RunContext, extra: { provider?: "meta" | "mock"; detail?: string } = {}): Promise<PublishOutcome> {
  const decision = afterFailure({ scheduledFor: job.scheduledFor, attempts: job.attempts, publishCalled: Boolean(job.publishCallAt) }, reason, new Date());
  if (decision.kind === "fail") return final(job, decision.reason, ctx, extra);
  // Nothing sent to Instagram yet: back to Scheduled (it can still be cancelled or moved). Otherwise it stays Publishing.
  const started = Boolean(job.containerId || job.childContainerIds.length || job.publishCallAt);
  await db.scheduledPost.update({
    where: { id: job.id },
    data: {
      status: started ? "PUBLISHING" : "SCHEDULED",
      leaseUntil: null,
      nextAttemptAt: decision.at,
      waitingReason: decision.waiting,
      ...(decision.kind === "retry" && { attempts: decision.attempts }),
    },
  });
  await logIntegration({
    businessId: job.businessId,
    provider: extra.provider ?? "meta",
    level: "warning",
    call: "publish post",
    errorCode: reason,
    message: `${LOG_TEXT[reason]}${extra.detail ? ` ${extra.detail}` : ""} Next try ${decision.at.toISOString()}.`,
    details: { scheduledPostId: job.id, draftId: job.draftId, trigger: ctx.trigger, reason, outcome: decision.kind, attempts: decision.kind === "retry" ? decision.attempts : job.attempts },
  });
  return { ok: false, jobId: job.id, reason, final: false };
}

/** Failed for good: the owner sees the reason with Reschedule / Cancel; the draft is back among the drafts. */
async function final(job: Job, reason: PublishReason, ctx: RunContext, extra: { provider?: "meta" | "mock"; detail?: string } = {}): Promise<PublishOutcome> {
  try {
    await db.$transaction(async (tx) => {
      await tx.scheduledPost.update({ where: { id: job.id }, data: { status: "FAILED", failureReason: reason, waitingReason: null, leaseUntil: null, nextAttemptAt: null } });
      const stillActive = await tx.scheduledPost.count({ where: { draftId: job.draftId, status: { in: ["SCHEDULED", "PUBLISHING"] } } });
      await tx.postDraft.update({ where: { id: job.draftId }, data: { publishError: reason, ...(stillActive === 0 && { status: "DRAFT" }) } });
      await logActivity({ businessId: job.businessId, userId: ctx.userId ?? null, action: "post.publish_failed", details: { draftId: job.draftId, scheduledPostId: job.id, reason, trigger: ctx.trigger } }, tx);
    });
  } catch (error) {
    console.error("[publish] couldn't record the failure", (error as Error).message);
  }
  // The owner isn't watching a scheduled or "Post now" job: tell them. An inline "Publish now" shows its result on screen.
  if (ctx.trigger !== "manual") await notify({ businessId: job.businessId, type: "post_failed", params: { reason } });
  await logIntegration({
    businessId: job.businessId,
    provider: extra.provider ?? "meta",
    level: reason === "no_image" ? "warning" : "error",
    call: "publish post",
    errorCode: reason,
    message: extra.detail ? `${LOG_TEXT[reason]} ${extra.detail}` : LOG_TEXT[reason],
    details: { scheduledPostId: job.id, draftId: job.draftId, trigger: ctx.trigger, reason, outcome: "failed", containerId: job.containerId },
  });
  return { ok: false, jobId: job.id, reason, final: true };
}

/** Instagram is connected again: posts that were waiting for it go out at the next run instead of their next check. */
export async function resumeHeldPosts(businessId: string): Promise<number> {
  const { count } = await db.scheduledPost.updateMany({
    where: { businessId, waitingReason: "not_connected", status: { in: ["SCHEDULED", "PUBLISHING"] } },
    data: { nextAttemptAt: null },
  });
  return count;
}

/** The daily cron: frozen copies of cancelled / failed jobs older than 30 days (posted ones are deleted at once). */
export async function purgePublishMedia(now = new Date()): Promise<{ deleted: number }> {
  const before = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const rows = await db.scheduledPost.findMany({
    where: { status: { in: ["CANCELLED", "FAILED"] }, updatedAt: { lt: before }, mediaKeys: { isEmpty: false } },
    select: { id: true, mediaKeys: true },
    take: 200,
  });
  for (const row of rows) {
    await deleteMedia(row.mediaKeys);
    await db.scheduledPost.update({ where: { id: row.id }, data: { mediaKeys: [] } });
  }
  return { deleted: rows.length };
}
