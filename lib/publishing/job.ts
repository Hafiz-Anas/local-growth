/**
 * The publishing job's rules (BE3), pure so they're tested on their own (tests/publishing-job.test.ts).
 * lib/server/publishing.ts stores the job (ScheduledPost) and calls Instagram; everything it decides —
 * which step comes next, what a container's status means, whether a failure is retried, waited out or
 * final — comes from here.
 *
 * States the owner sees: Scheduled → Publishing → Posted, or Failed (with a reason and Reschedule), or
 * Cancelled. A due post that can't go out yet (Instagram to reconnect, a rate limit, its daily limit,
 * processing) stays Scheduled/Publishing with a `waitingReason`, shown as "Waiting for Instagram".
 */

export type PublishReason =
  | "no_image"
  | "too_many_photos"
  | "caption_too_long"
  | "too_many_hashtags"
  | "too_many_mentions"
  | "image_unreadable"
  | "image_not_public"
  | "image_unreachable"
  | "media_rejected"
  | "processing_timeout"
  | "daily_limit"
  | "uncertain"
  | "network"
  | "not_connected"
  | "account_changed"
  | "permission"
  | "rate_limited"
  | "feature_disabled"
  | "missed_window"
  | "interrupted"
  | "failed";

export const PUBLISH_REASONS: readonly PublishReason[] = [
  "no_image",
  "too_many_photos",
  "caption_too_long",
  "too_many_hashtags",
  "too_many_mentions",
  "image_unreadable",
  "image_not_public",
  "image_unreachable",
  "media_rejected",
  "processing_timeout",
  "daily_limit",
  "uncertain",
  "network",
  "not_connected",
  "account_changed",
  "permission",
  "rate_limited",
  "feature_disabled",
  "missed_window",
  "interrupted",
  "failed",
];

/** Failed steps before a job fails for good (each one waits longer: PUBLISH_BACKOFF_MIN). */
export const PUBLISH_MAX_ATTEMPTS = 5;
export const PUBLISH_BACKOFF_MIN = [2, 5, 15, 30, 60] as const;
/** A due post waits at most this long (reconnect, daily limit, scheduler down) before it fails as missed. */
export const PUBLISH_MAX_LATE_MS = 6 * 60 * 60 * 1000;
/**
 * How long a worker holds a job; renewed before every step (a step — at most a couple of Instagram calls of
 * ≤ 20 s each plus retries — always ends well within it). Past it the worker is considered dead: the next
 * run takes the job over (counted as an "interrupted" attempt) and checks Instagram before anything else.
 */
export const PUBLISH_LEASE_MS = 3 * 60 * 1000;
/** A container still processing is checked again after this (Meta: once a minute, at most 5 minutes). */
export const PROCESSING_RECHECK_MS = 60 * 1000;
export const PROCESSING_MAX_MS = 10 * 60 * 1000;
/** Waiting for a reconnect or the daily limit: checked again after this. */
export const HOLD_RECHECK_MS = 5 * 60 * 1000;
export const DAILY_LIMIT_RECHECK_MS = 60 * 60 * 1000;

/** Fixed by the owner (new photo, caption, reconnect with the permission…): retrying the same post won't help. */
const FINAL: ReadonlySet<PublishReason> = new Set([
  "no_image",
  "too_many_photos",
  "caption_too_long",
  "too_many_hashtags",
  "too_many_mentions",
  "image_unreadable",
  "image_not_public",
  "media_rejected",
  "permission",
  "account_changed",
  "feature_disabled",
  "missed_window",
  "failed",
]);

/** Waited out without using an attempt, until the post is PUBLISH_MAX_LATE_MS late. */
const HOLD: ReadonlySet<PublishReason> = new Set(["not_connected", "daily_limit"]);

export interface JobTiming {
  scheduledFor: Date;
  attempts: number;
  /** media_publish was sent at least once (from then on, never "missed": the job only checks and finishes). */
  publishCalled: boolean;
}

export type FailureDecision =
  | { kind: "retry"; at: Date; attempts: number; waiting: PublishReason }
  | { kind: "hold"; at: Date; waiting: PublishReason }
  | { kind: "fail"; reason: PublishReason };

const late = (job: JobTiming, now: Date) => now.getTime() - job.scheduledFor.getTime() > PUBLISH_MAX_LATE_MS;

/** What to do after a step failed with `reason`. */
export function afterFailure(job: JobTiming, reason: PublishReason, now: Date): FailureDecision {
  if (FINAL.has(reason)) return { kind: "fail", reason };
  if (HOLD.has(reason)) {
    // Once media_publish was sent the post may be live: never give up on checking it because of a reconnect.
    if (late(job, now) && !job.publishCalled) return { kind: "fail", reason };
    return { kind: "hold", at: new Date(now.getTime() + (reason === "daily_limit" ? DAILY_LIMIT_RECHECK_MS : HOLD_RECHECK_MS)), waiting: reason };
  }
  const attempts = job.attempts + 1;
  if (attempts >= PUBLISH_MAX_ATTEMPTS) return { kind: "fail", reason };
  const minutes = PUBLISH_BACKOFF_MIN[Math.min(attempts - 1, PUBLISH_BACKOFF_MIN.length - 1)];
  return { kind: "retry", at: new Date(now.getTime() + minutes * 60_000), attempts, waiting: reason };
}

/** A due job that hasn't started publishing and is too late: it isn't posted at a surprising time. */
export function isMissed(job: JobTiming, now: Date): boolean {
  return !job.publishCalled && late(job, now);
}

export type ContainerCode = "EXPIRED" | "ERROR" | "FINISHED" | "IN_PROGRESS" | "PUBLISHED";

export type ContainerDecision =
  /** On Instagram: record it (find the media id) and finish. */
  | { kind: "posted" }
  /** Ready and not published yet: send media_publish. */
  | { kind: "publish" }
  /** Still processing: check again later. */
  | { kind: "wait" }
  /** Not published and can't be (expired), or not to be used (rescheduled): drop the containers and start again. */
  | { kind: "restart" }
  | { kind: "fail"; reason: PublishReason };

/**
 * What a container's status means. Instagram publishes a container at most once and only `PUBLISHED` says it
 * did, so anything else means the post isn't live yet — that is the duplicate protection. `fresh`: the
 * containers weren't made for this attempt (a rescheduled job checking its old one), so a FINISHED one is
 * dropped rather than published with what may be an outdated caption.
 */
export function onContainerStatus(code: ContainerCode, { fresh, processingSince, now }: { fresh: boolean; processingSince: Date | null; now: Date }): ContainerDecision {
  if (code === "PUBLISHED") return { kind: "posted" };
  if (code === "EXPIRED") return { kind: "restart" };
  if (code === "ERROR") return { kind: "fail", reason: "media_rejected" };
  if (!fresh) return { kind: "restart" };
  if (code === "FINISHED") return { kind: "publish" };
  if (processingSince && now.getTime() - processingSince.getTime() > PROCESSING_MAX_MS) return { kind: "fail", reason: "processing_timeout" };
  return { kind: "wait" };
}

export interface JobShape {
  format: "IMAGE" | "CAROUSEL";
  photos: number;
  childContainerIds: string[];
  containerId: string | null;
  publishCalled: boolean;
  verifyFirst: boolean;
}

export type Step = "create_child" | "create_container" | "check";

/** The next Instagram step for a job (it resumes wherever the last run stopped). */
export function nextStep(job: JobShape): Step {
  if (job.containerId) return "check";
  if (job.format === "CAROUSEL" && job.childContainerIds.length < job.photos) return "create_child";
  return "create_container";
}

/** What the owner sees for a job. */
export type PublishState = "scheduled" | "waiting" | "publishing" | "posted" | "failed" | "cancelled";

/**
 * A due job nobody has touched for this long after it should have run is shown as delayed: the publish cron
 * runs every minute and a run never holds a job longer than PUBLISH_LEASE_MS, so this means the scheduler
 * isn't reaching it (stopped, failing, or a crashed run whose lease hasn't been taken over yet).
 */
export const STALLED_AFTER_MS = 5 * 60 * 1000;

/** Shown reason (a waiting note) for a stalled job; not a PublishReason, nothing stores it. */
export const DELAYED_REASON = "delayed";

export interface PublishJobView {
  status: "SCHEDULED" | "PUBLISHING" | "PUBLISHED" | "FAILED" | "CANCELLED";
  scheduledFor: Date;
  waitingReason: string | null;
  failureReason?: string | null;
  /** When the job may run next (backoff / processing / hold). */
  nextAttemptAt?: Date | null;
  /** The job's last change (any step saves one). */
  updatedAt?: Date | null;
}

/** The state and the reason line the owner sees (the reason: failure reason, waiting reason, or "delayed"). */
export function publishViewOf(job: PublishJobView, now: Date): { state: PublishState; reason: string | null } {
  if (job.status === "PUBLISHED") return { state: "posted", reason: null };
  if (job.status === "FAILED") return { state: "failed", reason: job.failureReason ?? null };
  if (job.status === "CANCELLED") return { state: "cancelled", reason: null };
  const due = job.scheduledFor <= now;
  if (!due && job.status === "SCHEDULED") return { state: "scheduled", reason: null };
  // Should have run by `runAt` and nothing changed since: the scheduler isn't reaching it.
  const runAt = Math.max(job.scheduledFor.getTime(), job.nextAttemptAt?.getTime() ?? 0, job.updatedAt?.getTime() ?? 0);
  if (job.updatedAt !== undefined && now.getTime() - runAt > STALLED_AFTER_MS) return { state: "waiting", reason: DELAYED_REASON };
  if (job.waitingReason && due) return { state: "waiting", reason: job.waitingReason };
  return { state: "publishing", reason: null };
}

export function publishStateOf(job: PublishJobView, now: Date): PublishState {
  return publishViewOf(job, now).state;
}

/** Reasons the owner can fix by reconnecting Instagram (the UI offers Reconnect next to them). */
export const RECONNECT_REASONS: ReadonlySet<PublishReason> = new Set(["not_connected", "permission", "account_changed"]);

export function isPublishReason(value: unknown): value is PublishReason {
  return typeof value === "string" && (PUBLISH_REASONS as readonly string[]).includes(value);
}
