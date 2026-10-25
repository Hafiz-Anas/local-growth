import "server-only";

/**
 * Rate limiting behind an interface. Callers (login, password reset) only use
 * `getRateLimiter()`; to share limits across instances, add a Redis-backed
 * implementation and select it with RATE_LIMIT_STORE — callers don't change.
 * All methods are async so a network-backed store fits the same shape.
 */
export interface RateLimitRule {
  /** Namespace, e.g. "login". */
  name: string;
  limit: number;
  windowMs: number;
}

export interface RateLimiter {
  /** True when the key has used up its attempts for the current window. */
  isLimited(rule: RateLimitRule, key: string): Promise<boolean>;
  /** Counts one attempt against the key. */
  hit(rule: RateLimitRule, key: string): Promise<void>;
  /** Checks and counts in one step. Resolves false when the request should be rejected. */
  consume(rule: RateLimitRule, key: string): Promise<boolean>;
  /** Clears the key (e.g. after a successful login). */
  reset(rule: RateLimitRule, key: string): Promise<void>;
}

export const LOGIN_LIMIT: RateLimitRule = { name: "login", limit: 5, windowMs: 15 * 60 * 1000 };
export const RESET_REQUEST_LIMIT: RateLimitRule = { name: "reset-request", limit: 3, windowMs: 15 * 60 * 1000 };
export const RESET_CONFIRM_LIMIT: RateLimitRule = { name: "reset-confirm", limit: 10, windowMs: 15 * 60 * 1000 };
export const PASSWORD_CHANGE_LIMIT: RateLimitRule = { name: "password-change", limit: 5, windowMs: 15 * 60 * 1000 };
/** Sign-up attempts per IP (counts every attempt, like login counts failures). */
export const SIGNUP_LIMIT: RateLimitRule = { name: "signup", limit: 5, windowMs: 15 * 60 * 1000 };
export const VERIFY_RESEND_LIMIT: RateLimitRule = { name: "verify-resend", limit: 3, windowMs: 15 * 60 * 1000 };
/** "Report a problem" notes per business. */
export const FEEDBACK_LIMIT: RateLimitRule = { name: "feedback", limit: 10, windowMs: 15 * 60 * 1000 };
/** "Sync now" (Meta) per business. */
export const INSTAGRAM_SYNC_LIMIT: RateLimitRule = { name: "instagram-sync", limit: 1, windowMs: 60 * 1000 };
/** "Regenerate" on reply drafts per business (each one is an AI call; the AI's own daily budget applies too). */
export const REPLY_REGENERATE_LIMIT: RateLimitRule = { name: "reply-regenerate", limit: 30, windowMs: 60 * 60 * 1000 };
/** AI explanations of competitors and posts per business (each is an AI call; the AI's daily budget applies too). */
export const COMPETITOR_INSIGHT_LIMIT: RateLimitRule = { name: "competitor-insight", limit: 10, windowMs: 60 * 60 * 1000 };
export const POST_INSIGHT_LIMIT: RateLimitRule = { name: "post-insight", limit: 20, windowMs: 60 * 60 * 1000 };
/** AI post-method suggestions (one batched call each) per business. */
export const METHODS_AI_LIMIT: RateLimitRule = { name: "methods-ai", limit: 4, windowMs: 60 * 60 * 1000 };
/** Posts a business starts monitoring per hour (each start reads the post from Instagram). */
export const MONITOR_START_LIMIT: RateLimitRule = { name: "monitor-start", limit: 30, windowMs: 60 * 60 * 1000 };
/** AI summaries of ended monitoring asked for again from the page, per business. */
export const MONITOR_SUMMARY_LIMIT: RateLimitRule = { name: "monitor-summary", limit: 10, windowMs: 60 * 60 * 1000 };
/** AI summaries of a Statistics period per business (each range is cached until its numbers change). */
export const STATISTICS_SUMMARY_LIMIT: RateLimitRule = { name: "statistics-summary", limit: 10, windowMs: 60 * 60 * 1000 };
/** Shareability findings requested from Post performance, per business (they're rewritten once a day at most anyway). */
export const SHARE_FINDINGS_LIMIT: RateLimitRule = { name: "share-findings", limit: 6, windowMs: 60 * 60 * 1000 };
/** AI post images per business (each one costs a paid model call). */
export const IMAGE_GENERATION_LIMIT: RateLimitRule = { name: "image-generation", limit: 20, windowMs: 60 * 60 * 1000 };
/** Photo style-guide analyses per business (each is one AI call with up to 5 images; the AI's daily budget applies too). */
export const STYLE_GUIDE_LIMIT: RateLimitRule = { name: "style-guide", limit: 6, windowMs: 60 * 60 * 1000 };
/** Photos uploaded in onboarding's "Your style" per business. */
export const STYLE_UPLOAD_LIMIT: RateLimitRule = { name: "style-upload", limit: 30, windowMs: 60 * 60 * 1000 };
/** AI competitor suggestions asked for per business (stored once they worked). */
export const COMPETITOR_SUGGEST_LIMIT: RateLimitRule = { name: "competitor-suggest", limit: 3, windowMs: 60 * 60 * 1000 };

interface Bucket {
  count: number;
  resetAt: number;
}

/** Fixed-window counters in process memory. Correct for a single server instance. */
export class InMemoryRateLimiter implements RateLimiter {
  private buckets = new Map<string, Bucket>();

  private bucket(rule: RateLimitRule, key: string): Bucket {
    const id = `${rule.name}:${key}`;
    const now = Date.now();
    let bucket = this.buckets.get(id);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + rule.windowMs };
      this.buckets.set(id, bucket);
    }
    return bucket;
  }

  async isLimited(rule: RateLimitRule, key: string) {
    return this.bucket(rule, key).count >= rule.limit;
  }

  async hit(rule: RateLimitRule, key: string) {
    this.bucket(rule, key).count += 1;
  }

  async consume(rule: RateLimitRule, key: string) {
    const bucket = this.bucket(rule, key);
    if (bucket.count >= rule.limit) return false;
    bucket.count += 1;
    return true;
  }

  async reset(rule: RateLimitRule, key: string) {
    this.buckets.delete(`${rule.name}:${key}`);
  }
}

// Kept on globalThis so counters survive hot reloads in development.
const globalForLimiter = globalThis as unknown as { lgeRateLimiter?: RateLimiter };

export function getRateLimiter(): RateLimiter {
  if (globalForLimiter.lgeRateLimiter) return globalForLimiter.lgeRateLimiter;
  const store = process.env.RATE_LIMIT_STORE ?? "memory";
  switch (store) {
    case "memory":
      globalForLimiter.lgeRateLimiter = new InMemoryRateLimiter();
      break;
    default:
      throw new Error(`Unknown RATE_LIMIT_STORE "${store}".`);
  }
  return globalForLimiter.lgeRateLimiter;
}

/** Best-effort client IP from proxy headers. */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip") || "unknown";
}
