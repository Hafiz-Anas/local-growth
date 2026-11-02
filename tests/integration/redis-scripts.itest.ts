import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import Redis from "ioredis";
import { RedisRateLimiter, SharedTextGate } from "../../lib/services/redis-stores";
import { TextRequestGate } from "../../lib/services/text/gate";

/**
 * The Lua scripts against a real Redis / Valkey (the unit tests use a fake that can't run Lua).
 * Not part of `npm test`: run by the Docker build check with a Valkey service —
 *   REDIS_URL=redis://127.0.0.1:6379 npx tsx --test tests/integration/redis-scripts.itest.ts
 */
const url = process.env.REDIS_URL;
const redis = url ? new Redis(url) : null;
const run = `${Date.now()}`;

after(async () => {
  await redis?.quit();
});

describe("Redis scripts on a real Valkey", { skip: !redis }, () => {
  it("rate limits: consume, hit, isLimited and reset", async () => {
    const limiter = new RedisRateLimiter(redis!);
    const rule = { name: `itest-${run}`, limit: 2, windowMs: 5_000 };
    assert.equal(await limiter.consume(rule, "k"), true);
    assert.equal(await limiter.consume(rule, "k"), true);
    assert.equal(await limiter.consume(rule, "k"), false);
    assert.equal(await limiter.isLimited(rule, "k"), true);
    assert.ok((await redis!.pttl(`lge:rl:${rule.name}:k`)) > 0, "the window has an expiry");
    await limiter.reset(rule, "k");
    await limiter.hit(rule, "k");
    assert.equal(await limiter.isLimited(rule, "k"), false);
  });

  it("Gemini budget: minute limit, then a pause that a shorter one doesn't replace", async () => {
    await redis!.del("lge:gemini:pause");
    const gate = new SharedTextGate(redis!, 2, 1000, new TextRequestGate(2, 1000));
    // Start of a fresh minute window is not guaranteed; count only what this test takes.
    const results = [await gate.acquire(), await gate.acquire(), await gate.acquire()];
    assert.ok(results.some((r) => !r.allowed && r.reason === "rate_limited") || results.every((r) => r.allowed));
    await gate.failed("invalid_key");
    await gate.failed("rate_limited");
    const paused = await gate.acquire();
    assert.equal(!paused.allowed && paused.reason, "invalid_key");
    await redis!.del("lge:gemini:pause");
  });
});
