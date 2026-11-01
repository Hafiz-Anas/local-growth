import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { competitorSummary, followerGrowth, type SummaryPost } from "../lib/analysis/competitor-summary";

const NOW = Date.parse("2026-11-01T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 24 * 60 * 60 * 1000).toISOString();
const post = (id: string, d: number, format: SummaryPost["format"], likes: number, comments = 0): SummaryPost => ({ id, postedAt: daysAgo(d), format, likes, comments });

describe("followerGrowth (stored snapshots)", () => {
  it("compares the oldest and newest snapshot inside the last 30 days", () => {
    const snaps = [
      { takenAt: daysAgo(40), followers: 900 },
      { takenAt: daysAgo(28), followers: 1000 },
      { takenAt: daysAgo(14), followers: 1030 },
      { takenAt: daysAgo(0), followers: 1050 },
    ];
    assert.deepEqual(followerGrowth(snaps, NOW), { changePct: 5, change: 50, days: 28 });
  });

  it("needs two snapshots at least a week apart", () => {
    assert.equal(followerGrowth([{ takenAt: daysAgo(1), followers: 10 }], NOW), null);
    assert.equal(followerGrowth([{ takenAt: daysAgo(5), followers: 10 }, { takenAt: daysAgo(0), followers: 12 }], NOW), null);
    assert.equal(followerGrowth([{ takenAt: daysAgo(60), followers: 10 }, { takenAt: daysAgo(45), followers: 12 }], NOW), null);
  });

  it("reports a loss as a negative change", () => {
    assert.deepEqual(followerGrowth([{ takenAt: daysAgo(21), followers: 2000 }, { takenAt: daysAgo(0), followers: 1980 }], NOW), { changePct: -1, change: -20, days: 21 });
  });
});

describe("competitorSummary (their recent posts)", () => {
  it("posts per week, format shares and top posts over the last 30 days", () => {
    const posts = [post("a", 2, "reel", 300), post("b", 6, "reel", 260), post("c", 10, "photo", 100), post("d", 14, "photo", 120), post("e", 20, "carousel", 150), post("f", 26, "reel", 280), post("old", 45, "photo", 9999)];
    const s = competitorSummary(posts, NOW);
    assert.equal(s.days, 30);
    assert.equal(s.posts, 6);
    assert.equal(s.enough, true);
    assert.equal(s.postsPerWeek, 1.4);
    assert.deepEqual(s.formats, [
      { format: "reel", posts: 3, sharePct: 50 },
      { format: "photo", posts: 2, sharePct: 33 },
      { format: "carousel", posts: 1, sharePct: 17 },
    ]);
    assert.deepEqual(s.top, ["a", "f", "b"]);
    // Reels (avg 280) vs photos (avg 110): 2.5×.
    assert.deepEqual(s.observations[0], { kind: "formatLift", best: "reel", other: "photo", ratio: 2.5 });
  });

  it("when the posts we have don't reach back 30 days, the period is from the oldest one", () => {
    const s = competitorSummary([post("a", 1, "reel", 10), post("b", 4, "reel", 10), post("c", 7, "photo", 10)], NOW);
    assert.equal(s.days, 7);
    assert.equal(s.postsPerWeek, 3);
  });

  it("notes one post far above the rest, and a format that dominates", () => {
    const s = competitorSummary([post("hit", 1, "reel", 1000), post("b", 3, "reel", 100), post("c", 5, "reel", 120), post("d", 8, "reel", 90), post("e", 12, "photo", 100)], NOW);
    assert.deepEqual(s.observations, [
      { kind: "standout", ratio: 9.8 },
      { kind: "mostly", format: "reel", sharePct: 80 },
    ]);
  });

  it("no observation without a clear difference", () => {
    const s = competitorSummary([post("a", 1, "reel", 100), post("b", 3, "photo", 110), post("c", 5, "reel", 105), post("d", 8, "photo", 95)], NOW);
    assert.deepEqual(s.observations, []);
  });

  it("no recent posts at all: the period is the whole 30 days", () => {
    const s = competitorSummary([post("old", 40, "photo", 10)], NOW);
    assert.deepEqual({ days: s.days, posts: s.posts, enough: s.enough, top: s.top }, { days: 30, posts: 0, enough: false, top: [] });
  });

  it("a few posts in the last two days still count over a week, not over a day", () => {
    const s = competitorSummary([post("a", 0.2, "reel", 10), post("b", 0.5, "reel", 10), post("c", 1.5, "photo", 10)], NOW);
    assert.equal(s.days, 7);
    assert.equal(s.postsPerWeek, 3);
  });

  it("not enough recent posts: no numbers, only what we have", () => {
    const s = competitorSummary([post("a", 2, "reel", 10), post("b", 50, "photo", 10), { id: "untimed", likes: 5, comments: 0 }], NOW);
    assert.equal(s.enough, false);
    assert.equal(s.posts, 1);
    assert.equal(s.postsPerWeek, null);
    assert.equal(s.days, 30);
    assert.deepEqual(s.formats, []);
    assert.deepEqual(s.observations, []);
    assert.deepEqual(s.top, ["a"]);
  });
});
