import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeGrowthSignals, impactOf, rankSignals, SIGNAL_MIN_ACCOUNT_POSTS } from "../lib/analysis/growth-signals";
import { computeShareability } from "../lib/analysis/shareability";
import { GROWTH_TZ, growthPosts } from "./fixtures/growth-posts";

const TZ = GROWTH_TZ;
const fixturePosts = growthPosts;
const signalsOf = (posts = fixturePosts()) => computeGrowthSignals(posts, { timeZone: TZ, shareability: computeShareability(posts, { timeZone: TZ }) });

describe("Growth signals", () => {
  it("finds what beats the account's own average on shares, saves, comments and reach", () => {
    const { signals, posts } = signalsOf();
    assert.equal(posts, 12);
    const byKind = Object.fromEntries(signals.map((s) => [s.kind, s]));
    // Shares: Reels 5% of reach vs 3.3% pooled (574 shares ÷ 17,400 reach).
    assert.deepEqual([byKind.shares.format, byKind.shares.value, byKind.shares.average, byKind.shares.liftPct, byKind.shares.posts], ["reel", 5, 3.3, 52, 5]);
    // Saves: carousels 5% vs 2.7% (470 ÷ 17,400).
    assert.deepEqual([byKind.saves.format, byKind.saves.value, byKind.saves.average, byKind.saves.liftPct], ["carousel", 5, 2.7, 85]);
    assert.deepEqual([byKind.comments.format, byKind.comments.value, byKind.comments.average, byKind.comments.liftPct], ["carousel", 20, 10, 100]);
    assert.deepEqual([byKind.reach_format.format, byKind.reach_format.value, byKind.reach_format.average, byKind.reach_format.liftPct], ["reel", 2000, 1450, 38]);
    // Thursday 17:00 UTC is 20:00 in Kuwait: Thursday evening.
    assert.deepEqual([byKind.reach_time.weekday, byKind.reach_time.dayPart, byKind.reach_time.value, byKind.reach_time.posts], ["thu", "evening", 2000, 5]);
    assert.deepEqual(byKind.shares.metric, "shares");
    assert.deepEqual(byKind.reach_time.metric, "reach");
  });

  it("ranks by expected impact, then by strength, and numbers the signals in that order", () => {
    const { signals, bestSlot } = signalsOf();
    assert.deepEqual(
      signals.map((s) => [s.id, s.kind, s.impact]),
      [
        ["s1", "shares", "high"],
        ["s2", "comments", "medium"],
        ["s3", "saves", "medium"],
        ["s4", "reach_format", "medium"],
        ["s5", "reach_time", "medium"],
      ],
    );
    assert.deepEqual(bestSlot, { weekday: "thu", dayPart: "evening" });
  });

  it("expected impact needs both a big lift and enough posts", () => {
    assert.equal(impactOf(52, 5), "high");
    assert.equal(impactOf(52, 3), "medium");
    assert.equal(impactOf(100, 2), "medium");
    assert.equal(impactOf(30, 4), "medium");
    assert.equal(impactOf(30, 2), "low");
    assert.equal(impactOf(20, 9), "low");
    const ranked = rankSignals([
      { impact: "low" as const, score: 500 },
      { impact: "high" as const, score: 10 },
      { impact: "medium" as const, score: 20 },
      { impact: "medium" as const, score: 90 },
    ]);
    assert.deepEqual(ranked.map((s) => [s.impact, s.score]), [["high", 10], ["medium", 90], ["medium", 20], ["low", 500]]);
  });

  it("no share signals without the shareability numbers; nothing with too few posts", () => {
    const posts = fixturePosts();
    assert.ok(!computeGrowthSignals(posts, { timeZone: TZ }).signals.some((s) => s.kind === "shares"));
    const few = posts.slice(0, SIGNAL_MIN_ACCOUNT_POSTS - 1);
    assert.deepEqual(computeGrowthSignals(few, { timeZone: TZ }), { posts: SIGNAL_MIN_ACCOUNT_POSTS - 1, signals: [], bestSlot: null });
    // Posts without Instagram's numbers don't count.
    assert.equal(computeGrowthSignals(posts.map((p) => ({ ...p, reach: null })), { timeZone: TZ }).signals.length, 0);
  });

  it("a group of one post, or of every post, is not a signal", () => {
    // Only Reels: no post type stands out against itself.
    const reels = fixturePosts().filter((p) => p.format === "reel");
    assert.ok(!signalsOf(reels).signals.some((s) => s.format));
    // One carousel with huge comments: one post isn't a pattern.
    const one = [...fixturePosts().filter((p) => p.format !== "carousel"), { ...fixturePosts()[10], comments: 500 }];
    assert.ok(!signalsOf(one).signals.some((s) => s.kind === "comments" && s.format === "carousel"));
  });
});
