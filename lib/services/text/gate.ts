import type { TextFailureReason } from "./errors";

/**
 * Keeps text generation inside Gemini's free tier: at most `rpm` requests per
 * rolling minute and `rpd` per day (the day resets at midnight Pacific time,
 * like Google's quota), and after a failure that will repeat (quota, billing,
 * bad key, retired model) no calls at all for a while — those requests go
 * straight to the template text instead of burning quota and filling the
 * integration log. Per server instance (in memory). Pure, with an injectable
 * clock, for tests.
 */

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** How long to stop calling after each kind of failure (the provider's RetryInfo wins when it is longer). */
export const COOLDOWN_MS: Partial<Record<TextFailureReason, number>> = {
  rate_limited: MINUTE,
  daily_limit: 60 * MINUTE,
  billing: 30 * MINUTE,
  invalid_key: 30 * MINUTE,
  not_configured: 30 * MINUTE,
  region: 60 * MINUTE,
  model_unavailable: 30 * MINUTE,
};
/** Never trust a RetryInfo for longer than this (a deploy with a new key should take effect soon). */
const MAX_COOLDOWN_MS = 6 * 60 * MINUTE;

export type GateDecision =
  | { allowed: true }
  /** `budget`: refused by our own per-minute or daily budget (not a pause after a failure). */
  | { allowed: false; reason: TextFailureReason; until: number; budget: boolean };

const PACIFIC = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hourCycle: "h23", hour: "numeric", minute: "numeric", second: "numeric" });

/** When the Pacific-time day containing `t` ends (when Google's daily quota resets). */
export function pacificDayEnd(t: number): number {
  const part = (type: string) => Number(PACIFIC.formatToParts(t).find((p) => p.type === type)?.value ?? 0);
  const intoDay = ((part("hour") * 60 + part("minute")) * 60 + part("second")) * 1000 + (t % 1000);
  return t - intoDay + DAY;
}

export class TextRequestGate {
  private sent: number[] = [];
  private pausedUntil = 0;
  private pauseReason: TextFailureReason = "rate_limited";
  private dayEnd = 0;
  private sentToday = 0;

  constructor(
    private readonly rpm: number,
    private readonly rpd: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Takes a slot for one request, or says why not. */
  acquire(): GateDecision {
    const t = this.now();
    if (t < this.pausedUntil) return { allowed: false, reason: this.pauseReason, until: this.pausedUntil, budget: false };
    if (t >= this.dayEnd) {
      this.dayEnd = pacificDayEnd(t);
      this.sentToday = 0;
    }
    if (this.sentToday >= this.rpd) return { allowed: false, reason: "daily_limit", until: this.dayEnd, budget: true };
    this.sent = this.sent.filter((s) => t - s < MINUTE);
    if (this.sent.length >= this.rpm) return { allowed: false, reason: "rate_limited", until: this.sent[0] + MINUTE, budget: true };
    this.sent.push(t);
    this.sentToday += 1;
    return { allowed: true };
  }

  /** Whether a request would be allowed right now, without taking a slot (for showing "unavailable" up front). */
  peek(): GateDecision {
    const t = this.now();
    if (t < this.pausedUntil) return { allowed: false, reason: this.pauseReason, until: this.pausedUntil, budget: false };
    if (t < this.dayEnd && this.sentToday >= this.rpd) return { allowed: false, reason: "daily_limit", until: this.dayEnd, budget: true };
    const recent = this.sent.filter((s) => t - s < MINUTE);
    if (recent.length >= this.rpm) return { allowed: false, reason: "rate_limited", until: recent[0] + MINUTE, budget: true };
    return { allowed: true };
  }

  /** Records a failed call; pauses the gate when the failure would repeat. */
  failed(reason: TextFailureReason, retryAfterMs: number | null = null) {
    const base = COOLDOWN_MS[reason];
    if (base === undefined) return;
    const wait = Math.min(Math.max(base, retryAfterMs ?? 0), MAX_COOLDOWN_MS);
    this.pausedUntil = Math.max(this.pausedUntil, this.now() + wait);
    this.pauseReason = reason;
  }
}
