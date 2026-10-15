import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AnalysisPost } from "../lib/analysis/posts";
import { BUCKET, RANGE_DAYS, STAT_RANGES, bucketStart, bucketsBetween, changePct, computeStatistics, followersOn, isStatRange } from "../lib/analysis/statistics";

const NOW = Date.parse("2026-10-15T12:00:00Z"); // a Thursday
const DAY = 24 * 60 * 60 * 1000;
let n = 0;
const post = (daysAgo: number, over: Partial<AnalysisPost> = {}): AnalysisPost => {
  n += 1;
  return { id: `p${n}`, caption: "", format: "photo", postedAt: new Date(NOW - daysAgo * DAY).toISOString(), likes: 90, comments: 10, reach: null, saves: null, shares: null, views: null, ...over };
};
const snap = (daysAgo: number, followers: number) => ({ date: new Date(NOW - daysAgo * DAY).toISOString().slice(0, 10), followers });

describe("ranges and buckets", () => {
  it("has the four ranges with day / week / month buckets", () => {
    assert.deepEqual([...STAT_RANGES], ["7d", "30d", "90d", "1y"]);
    assert.deepEqual(STAT_RANGES.map((r) => [RANGE_DAYS[r], BUCKET[r]]), [[7, "day"], [30, "day"], [90, "week"], [365, "month"]]);
    assert.ok(isStatRange("90d"));
    assert.ok(!isStatRange("2y"));
  });

  it("starts weeks on Monday and months on the 1st (UTC)", () => {
    assert.equal(bucketStart("2026-10-15", "day"), "2026-10-15");
    assert.equal(bucketStart("2026-10-15", "week"), "2026-10-12");
    assert.equal(bucketStart("2026-10-12", "week"), "2026-10-12");
    assert.equal(bucketStart("2026-10-18", "week"), "2026-10-12");
    assert.equal(bucketStart("2026-10-15", "month"), "2026-10-01");
    assert.deepEqual(bucketsBetween("2026-08-20", "2026-10-15", "month"), ["2026-08-01", "2026-09-01", "2026-10-01"]);
    assert.deepEqual(bucketsBetween("2026-10-13", "2026-10-15", "day"), ["2026-10-13", "2026-10-14", "2026-10-15"]);
    assert.equal(bucketsBetween("2025-10-16", "2026-10-15", "month").length, 13);
  });

  it("reads followers on a day from the snapshot on or before it", () => {
    const snaps = [snap(10, 1000), snap(5, 1100)];
    assert.equal(followersOn(snap(7, 0).date, snaps), 1000);
    assert.equal(followersOn(snap(1, 0).date, snaps), 1100);
    assert.equal(followersOn(snap(30, 0).date, snaps), 1000); // before the first: the earliest
    assert.equal(followersOn("2026-10-01", []), null);
  });
});

describe("a period's numbers", () => {
  const posts = [
    post(1, { likes: 190, comments: 10, reach: 2000, format: "reel" }), // 200
    post(3, { likes: 90, comments: 10, reach: 1000 }), // 100
    post(5, { likes: 40, comments: 10, reach: 0 }), // 50, reach not reported
    post(9, { likes: 70, comments: 10 }), // previous period (7d)
    post(12, { likes: 30, comments: 10 }), // previous
    post(20, { likes: 10, comments: 0 }), // outside both
  ];
  const snaps = [snap(13, 1000), snap(6, 1000), snap(3, 1050), snap(0, 1100)];
  const s = computeStatistics({ range: "7d", posts, snapshots: snaps, currentFollowers: 1100, timeZone: "Asia/Kuwait", now: NOW });

  it("covers the last 7 days, with the period before for comparison", () => {
    assert.equal(s.from, "2026-10-09");
    assert.equal(s.to, "2026-10-15");
    assert.equal(s.series.length, 7);
    assert.deepEqual(s.current, { posts: 3, postsPerWeek: 3, interactions: 350, avgInteractions: 116.7, avgReach: 1500, reachPosts: 2, engagementPct: 11.19 });
    assert.equal(s.previous?.posts, 2);
    assert.equal(s.previous?.avgInteractions, 60);
    assert.equal(changePct(s.current.avgInteractions, s.previous?.avgInteractions), 94.5);
  });

  it("measures followers from the last count before the period to the last one in it", () => {
    assert.deepEqual(s.followers, { start: 1000, end: 1100, change: 100, changePct: 10, points: 3 });
    assert.deepEqual(
      s.series.map((p) => p.followers),
      [1000, null, null, 1050, null, null, 1100],
    );
  });

  it("puts each post in its day, and ranks days, times and formats", () => {
    assert.deepEqual(
      s.series.map((p) => p.posts),
      [0, 1, 0, 1, 0, 1, 0],
    );
    assert.equal(s.series[5].interactions, 200);
    assert.equal(s.bestDays[0].avgInteractions, 200);
    assert.deepEqual(
      s.mix.map((m) => [m.format, m.posts]),
      [["reel", 1], ["photo", 2]],
    );
  });

  it("says from when data is available, and whether the period is fully covered", () => {
    assert.deepEqual(s.availability, { followersFrom: snaps[0].date, postsFrom: posts[5].postedAt.slice(0, 10), complete: true });
    const year = computeStatistics({ range: "1y", posts, snapshots: snaps, currentFollowers: 1100, timeZone: "Asia/Kuwait", now: NOW });
    assert.equal(year.availability.complete, false);
    assert.equal(year.series.length, 13);
    assert.equal(year.current.posts, 6);
    assert.equal(year.previous, null);
  });

  it("works with no data at all", () => {
    const empty = computeStatistics({ range: "30d", posts: [], snapshots: [], currentFollowers: null, timeZone: "Asia/Kuwait", now: NOW });
    assert.equal(empty.followers, null);
    assert.equal(empty.current.posts, 0);
    assert.equal(empty.current.engagementPct, null);
    assert.deepEqual(empty.availability, { followersFrom: null, postsFrom: null, complete: false });
    assert.deepEqual(empty.bestDays, []);
  });
});
