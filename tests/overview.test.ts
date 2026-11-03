import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeOverview, followerDelta, pickMetrics, type OverviewMetricKey } from "../lib/analysis/overview";
import type { AnalysisPost, PostFormat } from "../lib/analysis/posts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-11-03T12:00:00Z");

let n = 0;
function post(daysAgo: number, over: Partial<AnalysisPost> & { format?: PostFormat } = {}): AnalysisPost {
  return { id: `p${n++}`, caption: "", format: "photo", postedAt: new Date(NOW - daysAgo * DAY).toISOString(), likes: 40, comments: 10, reach: 500, saves: 6, shares: 4, views: null, ...over };
}
const day = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString().slice(0, 10);

describe("Insights overview: key numbers", () => {
  it("totals the last 7 days vs the 7 before, with the change and the posts each rests on", () => {
    const posts = [post(1, { reach: 700 }), post(3, { reach: 500 }), post(5, { reach: 300 }), post(8, { reach: 600 }), post(10, { reach: 400 }), post(12, { reach: 200 })];
    const o = computeOverview({ posts, followerSeries: [], goal: "sales", now: NOW });
    assert.deepEqual(o.metrics.map((m) => m.key), ["reach", "shares", "saves"]);
    const reach = o.metrics[0];
    assert.equal(reach.state, "ok");
    assert.equal(reach.current, 1500);
    assert.equal(reach.previous, 1200);
    assert.equal(reach.changePct, 25);
    assert.deepEqual(reach.posts, { current: 3, previous: 3 });
    // Shares: 12 vs 12 → no change.
    assert.equal(o.metrics[1].changePct, 0);
  });

  it("shows no change with fewer than 3 posts in either week, or a total too small for a percentage", () => {
    const thin = computeOverview({ posts: [post(1), post(2), post(3), post(9)], followerSeries: [], goal: null, now: NOW });
    assert.equal(thin.metrics[0].state, "no_compare");
    assert.equal(thin.metrics[0].changePct, null);
    const twoEach = computeOverview({ posts: [post(1), post(2), post(8), post(9)], followerSeries: [], goal: null, now: NOW });
    assert.equal(twoEach.metrics[0].state, "no_compare");
    assert.equal(twoEach.metrics[0].changePct, null);
    const small = computeOverview({ posts: [post(1, { shares: 3 }), post(2, { shares: 3 }), post(3, { shares: 3 }), post(8, { shares: 1 }), post(9, { shares: 1 }), post(10, { shares: 2 })], followerSeries: [], goal: "sales", now: NOW });
    const shares = small.metrics.find((m) => m.key === "shares")!;
    assert.equal(shares.state, "no_compare");
    assert.equal(shares.current, 9);
    assert.equal(shares.previous, 4);
  });

  it("says not enough data with no posts in the last 7 days (never a measured zero)", () => {
    const o = computeOverview({ posts: [post(9), post(11)], followerSeries: [], goal: null, now: NOW });
    const reach = o.metrics.find((m) => m.key === "reach")!;
    assert.equal(reach.state, "not_enough");
    assert.equal(reach.current, null);
  });

  it("leaves out posts Instagram has no number for", () => {
    const o = computeOverview({ posts: [post(1, { reach: null }), post(2), post(3)], followerSeries: [], goal: null, now: NOW });
    assert.deepEqual(o.metrics[0].posts, { current: 2, previous: 0 });
    assert.equal(o.metrics[0].current, 1000);
  });

  it("averages likes + comments per post", () => {
    const o = computeOverview({ posts: [post(1, { likes: 10, comments: 0 }), post(2, { likes: 20, comments: 5 })], followerSeries: [], goal: "more_engagement", now: NOW });
    assert.equal(o.metrics[0].key, "interactions");
    assert.equal(o.metrics[0].current, 17.5);
  });

  it("counts new followers from the daily counts, without a percentage", () => {
    const series = [{ date: day(15), followers: 900 }, { date: day(7), followers: 950 }, { date: day(0), followers: 1010 }];
    assert.equal(followerDelta(series, NOW - 7 * DAY, NOW), 60);
    const o = computeOverview({ posts: [], followerSeries: series, goal: "followers", now: NOW });
    const followers = o.metrics[0];
    assert.equal(followers.key, "newFollowers");
    assert.equal(followers.current, 60);
    assert.equal(followers.previous, 50);
    assert.equal(followers.changePct, null);
    assert.equal(followers.state, "ok");
    const none = computeOverview({ posts: [], followerSeries: [{ date: day(0), followers: 1000 }], goal: "followers", now: NOW });
    assert.equal(none.metrics.find((m) => m.key === "newFollowers")!.state, "not_enough");
  });
});

describe("Insights overview: metrics by goal", () => {
  const all = () => true;
  it("picks the goal's three", () => {
    assert.deepEqual(pickMetrics("followers", all), ["newFollowers", "reach", "shares"]);
    assert.deepEqual(pickMetrics("messages", all), ["reach", "comments", "shares"]);
    assert.deepEqual(pickMetrics(null, all), ["reach", "interactions", "newFollowers"]);
  });
  it("swaps out a metric the account never reports", () => {
    const noShares = (k: OverviewMetricKey) => k !== "shares";
    assert.deepEqual(pickMetrics("sales", noShares), ["reach", "saves", "interactions"]);
  });
  it("keeps the goal's three when nothing is reported (each then says not enough data)", () => {
    assert.deepEqual(pickMetrics("visits", () => false), ["reach", "saves", "shares"]);
  });
});

describe("Insights overview: weekly summary", () => {
  it("leads with the first number's change and names the post type that clearly did best, with the sample size", () => {
    const posts = [
      post(1, { reach: 900, format: "reel", likes: 200 }),
      post(3, { reach: 400, format: "photo" }),
      post(4, { reach: 500, format: "photo" }),
      post(9, { reach: 500, format: "reel", likes: 180 }),
      post(10, { reach: 500, format: "photo" }),
      post(11, { reach: 500, format: "photo" }),
    ];
    const s = computeOverview({ posts, followerSeries: [], goal: null, now: NOW }).summary!;
    assert.deepEqual(s.lead, { kind: "change", metric: "reach", direction: "up", pct: 20 });
    assert.equal(s.best?.format, "reel");
    assert.equal(s.best?.posts, 2);
    assert.deepEqual(s.posts, { current: 3, previous: 3 });
  });

  it("says 'about the same' for a small change and names no best type without a clear lead", () => {
    const posts = [post(1, { reach: 510 }), post(2, { reach: 500 }), post(3, { reach: 500 }), post(8), post(9), post(10)];
    const s = computeOverview({ posts, followerSeries: [], goal: null, now: NOW }).summary!;
    assert.equal(s.lead.kind === "change" && s.lead.direction, "flat");
    assert.equal(s.best, null);
  });

  it("falls back to the number of posts, and is null with fewer than 2 posts", () => {
    const s = computeOverview({ posts: [post(1, { reach: null }), post(2, { reach: null })], followerSeries: [], goal: "visits", now: NOW }).summary!;
    assert.deepEqual(s.lead, { kind: "posts", current: 2, previous: 0 });
    assert.equal(computeOverview({ posts: [post(1)], followerSeries: [], goal: null, now: NOW }).summary, null);
  });
});
