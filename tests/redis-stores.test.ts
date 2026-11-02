import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ACQUIRE, CONSUME, FallbackRateLimiter, HIT, PAUSE, RedisRateLimiter, SharedTextGate, type RedisLike } from "../lib/services/redis-stores";
import { InMemoryRateLimiterForTests } from "./helpers/in-memory-limiter";
import { TextRequestGate } from "../lib/services/text/gate";

/**
 * A fake Redis that runs our four Lua scripts in JS (Node can't run Lua). It checks the TypeScript side —
 * keys, arguments, how answers are read — while the scripts themselves run against a real Valkey in the
 * Docker build check (.github/workflows/docker-build.yml, "Redis scripts" step).
 */
class FakeRedis implements RedisLike {
  values = new Map<string, { value: string; expiresAt: number }>();
  down = false;
  constructor(public now: () => number = Date.now) {}

  private live(key: string) {
    const v = this.values.get(key);
    if (v && v.expiresAt <= this.now()) this.values.delete(key);
    return this.values.get(key)?.value ?? null;
  }
  private set(key: string, value: string, ttlMs: number) {
    this.values.set(key, { value, expiresAt: this.now() + ttlMs });
  }
  private incr(key: string, ttlMs: number) {
    const existing = this.values.get(key);
    const next = Number(this.live(key) ?? 0) + 1;
    this.set(key, String(next), next === 1 || !existing ? ttlMs : existing.expiresAt - this.now());
    return next;
  }

  async get(key: string) {
    if (this.down) throw new Error("ECONNREFUSED");
    return this.live(key);
  }
  async del(...keys: string[]) {
    if (this.down) throw new Error("ECONNREFUSED");
    keys.forEach((k) => this.values.delete(k));
    return keys.length;
  }
  async eval(script: string, _n: number, ...args: Array<string | number>) {
    if (this.down) throw new Error("ECONNREFUSED");
    if (script === CONSUME) {
      const [key, limit, window] = args;
      if (Number(this.live(String(key)) ?? 0) >= Number(limit)) return 0;
      this.incr(String(key), Number(window));
      return 1;
    }
    if (script === HIT) return this.incr(String(args[0]), Number(args[1]));
    if (script === ACQUIRE) {
      const [pause, minute, day, rpm, rpd, minuteTtl, dayTtl] = args.map(String);
      const p = this.live(pause);
      if (p) return [0, "pause", p];
      if (Number(this.live(day) ?? 0) >= Number(rpd)) return [0, "day", ""];
      if (Number(this.live(minute) ?? 0) >= Number(rpm)) return [0, "minute", ""];
      this.incr(minute, Number(minuteTtl));
      this.incr(day, Number(dayTtl));
      return [1, "", ""];
    }
    if (script === PAUSE) {
      const [key, value, until, ttl] = args.map(String);
      const p = this.live(key);
      if (p && Number(p.split("|")[1]) >= Number(until)) return 0;
      this.set(key, value, Number(ttl));
      return 1;
    }
    throw new Error("unknown script");
  }
}

const RULE = { name: "login", limit: 3, windowMs: 60_000 };

describe("RedisRateLimiter", () => {
  it("allows up to the limit, then refuses until the window ends; shared by every instance", async () => {
    let t = 1_000_000;
    const redis = new FakeRedis(() => t);
    const podA = new RedisRateLimiter(redis);
    const podB = new RedisRateLimiter(redis);
    assert.equal(await podA.consume(RULE, "ip"), true);
    assert.equal(await podB.consume(RULE, "ip"), true);
    assert.equal(await podA.consume(RULE, "ip"), true);
    assert.equal(await podB.consume(RULE, "ip"), false);
    assert.equal(await podA.isLimited(RULE, "ip"), true);
    t += 60_001;
    assert.equal(await podB.consume(RULE, "ip"), true);
  });

  it("hit counts, reset clears, keys are per rule and key", async () => {
    const redis = new FakeRedis();
    const limiter = new RedisRateLimiter(redis);
    for (let i = 0; i < 3; i++) await limiter.hit(RULE, "a@x.com");
    assert.equal(await limiter.isLimited(RULE, "a@x.com"), true);
    assert.equal(await limiter.isLimited(RULE, "b@x.com"), false);
    assert.equal(await limiter.isLimited({ ...RULE, name: "signup" }, "a@x.com"), false);
    await limiter.reset(RULE, "a@x.com");
    assert.equal(await limiter.isLimited(RULE, "a@x.com"), false);
    assert.ok([...redis.values.keys()].every((k) => k.startsWith("lge:rl:")));
  });
});

describe("FallbackRateLimiter", () => {
  it("uses memory while Redis is down, and Redis again when it's back", async () => {
    const redis = new FakeRedis();
    const memory = new InMemoryRateLimiterForTests();
    const limiter = new FallbackRateLimiter(new RedisRateLimiter(redis), memory);
    redis.down = true;
    const warn = console.warn;
    console.warn = () => undefined;
    try {
      assert.equal(await limiter.consume(RULE, "ip"), true);
      assert.equal(memory.count(RULE, "ip"), 1);
      redis.down = false;
      assert.equal(await limiter.consume(RULE, "ip"), true);
      assert.equal(memory.count(RULE, "ip"), 1);
      assert.equal(redis.values.size, 1);
    } finally {
      console.warn = warn;
    }
  });
});

describe("SharedTextGate (Gemini budget across instances)", () => {
  it("the per-minute budget is shared: two pods together get rpm requests a minute", async () => {
    let t = Date.parse("2026-11-02T10:00:05Z");
    const redis = new FakeRedis(() => t);
    const a = new SharedTextGate(redis, 3, 100, new TextRequestGate(3, 100, () => t), () => t);
    const b = new SharedTextGate(redis, 3, 100, new TextRequestGate(3, 100, () => t), () => t);
    assert.equal((await a.acquire()).allowed, true);
    assert.equal((await b.acquire()).allowed, true);
    assert.equal((await a.acquire()).allowed, true);
    const refused = await b.acquire();
    assert.deepEqual(refused, { allowed: false, reason: "rate_limited", until: Date.parse("2026-11-02T10:01:00Z"), budget: true });
    // peek() answers from what this pod last saw.
    assert.equal(b.peek().allowed, false);
    t = Date.parse("2026-11-02T10:01:01Z");
    assert.equal((await b.acquire()).allowed, true);
  });

  it("the daily budget is shared", async () => {
    const t = Date.parse("2026-11-02T10:00:00Z");
    const redis = new FakeRedis(() => t);
    const a = new SharedTextGate(redis, 100, 2, new TextRequestGate(100, 2, () => t), () => t);
    const b = new SharedTextGate(redis, 100, 2, new TextRequestGate(100, 2, () => t), () => t);
    await a.acquire();
    await b.acquire();
    const refused = await a.acquire();
    assert.equal(refused.allowed, false);
    assert.equal(!refused.allowed && refused.reason, "daily_limit");
  });

  it("a pause after a repeating failure stops every pod", async () => {
    const t = Date.parse("2026-11-02T10:00:00Z");
    const redis = new FakeRedis(() => t);
    const a = new SharedTextGate(redis, 100, 100, new TextRequestGate(100, 100, () => t), () => t);
    const b = new SharedTextGate(redis, 100, 100, new TextRequestGate(100, 100, () => t), () => t);
    await a.failed("invalid_key");
    const refused = await b.acquire();
    assert.equal(refused.allowed, false);
    assert.equal(!refused.allowed && refused.reason, "invalid_key");
    assert.equal(!refused.allowed && refused.budget, false);
    // A shorter pause (rate limit, 1 minute) never replaces a longer one (bad key, 30 minutes).
    await b.failed("rate_limited");
    const still = await a.acquire();
    assert.equal(!still.allowed && still.reason, "invalid_key");
  });

  it("falls back to this pod's own gate while Redis is down", async () => {
    const t = Date.parse("2026-11-02T10:00:00Z");
    const redis = new FakeRedis(() => t);
    redis.down = true;
    const gate = new SharedTextGate(redis, 1, 100, new TextRequestGate(1, 100, () => t), () => t);
    const warn = console.warn;
    console.warn = () => undefined;
    try {
      assert.equal((await gate.acquire()).allowed, true);
      assert.equal((await gate.acquire()).allowed, false);
    } finally {
      console.warn = warn;
    }
  });
});
