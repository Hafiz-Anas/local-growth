import type { RateLimitRule, RateLimiter } from "@/lib/server/rate-limit";
import type { TextFailureReason } from "./text/errors";
import { COOLDOWN_MS, MAX_COOLDOWN_MS, pacificDayEnd, type GateDecision, type TextRequestGate } from "./text/gate";

/**
 * Counters shared by every server instance through Redis / Valkey (RATE_LIMIT_STORE="redis"): the rate
 * limits (logins, AI calls, uploads…) and the Gemini request budget (GEMINI_TEXT_RPM / RPD). With several
 * pods each one would otherwise count on its own and the real limits would multiply.
 *
 * When Redis doesn't answer, both fall back to the in-memory versions (per instance, like before) and
 * say so once a minute in the log — a login must never fail because Redis is down.
 * Pure: the Redis client is injected (a few ioredis methods), so tests/redis-stores.test.ts uses a fake.
 */

/** The ioredis methods used here. */
export interface RedisLike {
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(...keys: string[]): Promise<number>;
}

const PREFIX = "lge:";

function warnOnce(state: { last: number }, what: string, error: unknown) {
  if (Date.now() - state.last < 60_000) return;
  state.last = Date.now();
  console.warn(`[redis] ${what} — using the in-memory fallback:`, (error as Error)?.message ?? error);
}

// ── Rate limits ─────────────────────────────────────────────────────────────

/** Counts one attempt unless the key is over its limit; starts the window on the first one. Returns 1 / 0. */
export const CONSUME = `
local c = tonumber(redis.call('GET', KEYS[1]) or '0')
if c >= tonumber(ARGV[1]) then return 0 end
c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
return 1`;

export const HIT = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return c`;

/** Fixed-window counters in Redis, the same rules as InMemoryRateLimiter. */
export class RedisRateLimiter implements RateLimiter {
  constructor(private readonly redis: RedisLike) {}

  private key(rule: RateLimitRule, key: string) {
    return `${PREFIX}rl:${rule.name}:${key}`;
  }

  async isLimited(rule: RateLimitRule, key: string) {
    return Number((await this.redis.get(this.key(rule, key))) ?? 0) >= rule.limit;
  }

  async hit(rule: RateLimitRule, key: string) {
    await this.redis.eval(HIT, 1, this.key(rule, key), rule.windowMs);
  }

  async consume(rule: RateLimitRule, key: string) {
    return Number(await this.redis.eval(CONSUME, 1, this.key(rule, key), rule.limit, rule.windowMs)) === 1;
  }

  async reset(rule: RateLimitRule, key: string) {
    await this.redis.del(this.key(rule, key));
  }
}

/** Uses `primary` (Redis) and, when it throws, `fallback` (memory) for that call. */
export class FallbackRateLimiter implements RateLimiter {
  private readonly warned = { last: 0 };
  constructor(
    private readonly primary: RateLimiter,
    private readonly fallback: RateLimiter,
  ) {}

  private async run<T>(call: (l: RateLimiter) => Promise<T>): Promise<T> {
    try {
      return await call(this.primary);
    } catch (error) {
      warnOnce(this.warned, "rate limit store unavailable", error);
      return call(this.fallback);
    }
  }

  isLimited(rule: RateLimitRule, key: string) {
    return this.run((l) => l.isLimited(rule, key));
  }
  hit(rule: RateLimitRule, key: string) {
    return this.run((l) => l.hit(rule, key));
  }
  consume(rule: RateLimitRule, key: string) {
    return this.run((l) => l.consume(rule, key));
  }
  reset(rule: RateLimitRule, key: string) {
    return this.run((l) => l.reset(rule, key));
  }
}

// ── Gemini request budget ───────────────────────────────────────────────────

/**
 * Takes a slot unless paused or over the minute / day budget. Returns {allowed, kind, pause}:
 * kind "pause" (pause = "reason|until"), "day" or "minute" when refused.
 */
export const ACQUIRE = `
local p = redis.call('GET', KEYS[1])
if p then return {0, 'pause', p} end
if tonumber(redis.call('GET', KEYS[3]) or '0') >= tonumber(ARGV[2]) then return {0, 'day', ''} end
if tonumber(redis.call('GET', KEYS[2]) or '0') >= tonumber(ARGV[1]) then return {0, 'minute', ''} end
redis.call('INCR', KEYS[2])
redis.call('PEXPIRE', KEYS[2], ARGV[3])
redis.call('INCR', KEYS[3])
redis.call('PEXPIRE', KEYS[3], ARGV[4])
return {1, '', ''}`;

/** Sets the pause unless a longer one is already set. */
export const PAUSE = `
local p = redis.call('GET', KEYS[1])
if p then
  local u = tonumber(string.match(p, '|(%d+)$') or '0')
  if u >= tonumber(ARGV[2]) then return 0 end
end
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[3])
return 1`;

/** A text gate: the in-memory TextRequestGate, or SharedTextGate across instances. */
export interface TextGate {
  acquire(): GateDecision | Promise<GateDecision>;
  /** Whether a request would be allowed now, without taking a slot (a hint for the UI; acquire decides). */
  peek(): GateDecision;
  failed(reason: TextFailureReason, retryAfterMs?: number | null): void | Promise<void>;
}

const MINUTE = 60_000;

/**
 * The Gemini budget shared by every instance: per-minute (fixed minute windows) and per-day (Pacific day,
 * like Google's quota) counters, and the pause after a failure that would repeat, all in Redis. peek() is
 * answered from what this instance last saw (it must stay synchronous); acquire() is the real check.
 */
export class SharedTextGate implements TextGate {
  private readonly warned = { last: 0 };
  /** The last refusal this instance saw, for peek(). */
  private seen: Extract<GateDecision, { allowed: false }> | null = null;

  constructor(
    private readonly redis: RedisLike,
    private readonly rpm: number,
    private readonly rpd: number,
    private readonly local: TextRequestGate,
    private readonly now: () => number = Date.now,
  ) {}

  async acquire(): Promise<GateDecision> {
    const t = this.now();
    const minute = Math.floor(t / MINUTE);
    const dayEnd = pacificDayEnd(t);
    try {
      const [allowed, kind, pause] = (await this.redis.eval(
        ACQUIRE,
        3,
        `${PREFIX}gemini:pause`,
        `${PREFIX}gemini:m:${minute}`,
        `${PREFIX}gemini:d:${dayEnd}`,
        this.rpm,
        this.rpd,
        2 * MINUTE,
        dayEnd - t + MINUTE,
      )) as [number, string, string];
      if (Number(allowed) === 1) {
        this.seen = null;
        return { allowed: true };
      }
      let decision: Extract<GateDecision, { allowed: false }>;
      if (kind === "pause") {
        const [reason, until] = String(pause).split("|");
        decision = { allowed: false, reason: reason as TextFailureReason, until: Number(until), budget: false };
      } else if (kind === "day") decision = { allowed: false, reason: "daily_limit", until: dayEnd, budget: true };
      else decision = { allowed: false, reason: "rate_limited", until: (minute + 1) * MINUTE, budget: true };
      this.seen = decision;
      return decision;
    } catch (error) {
      warnOnce(this.warned, "Gemini budget store unavailable", error);
      return this.local.acquire();
    }
  }

  peek(): GateDecision {
    if (this.seen && this.now() < this.seen.until) return this.seen;
    return this.local.peek();
  }

  async failed(reason: TextFailureReason, retryAfterMs: number | null = null) {
    this.local.failed(reason, retryAfterMs);
    const base = COOLDOWN_MS[reason];
    if (base === undefined) return;
    const wait = Math.min(Math.max(base, retryAfterMs ?? 0), MAX_COOLDOWN_MS);
    const until = this.now() + wait;
    this.seen = { allowed: false, reason, until, budget: false };
    try {
      await this.redis.eval(PAUSE, 1, `${PREFIX}gemini:pause`, `${reason}|${until}`, until, wait);
    } catch (error) {
      warnOnce(this.warned, "Gemini budget store unavailable", error);
    }
  }
}
