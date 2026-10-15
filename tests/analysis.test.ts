import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { METHODS, mentionsIn, methodMix, promotedVsOrganic, rankMethods, ruleMethod, type ClassifiedPost } from "../lib/analysis/methods";
import { accountStats, compareAccounts, dayPartOf, fingerprint, formatOf, hashtagCounts, localWeekdayHour, weeklyGrowth, type AnalysisPost } from "../lib/analysis/posts";
import { postSeries, postVsAverage, recentSummary } from "../lib/analysis/post-performance";
import { generatedMedia, growthShare, mockCompetitorPostDetails } from "../mock-data/posts";

const NOW = Date.parse("2026-10-15T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

let n = 0;
function post(over: Partial<AnalysisPost> = {}): AnalysisPost {
  n += 1;
  return { id: `p${n}`, caption: "", format: "photo", postedAt: new Date(NOW - n * DAY).toISOString(), likes: 100, comments: 10, reach: null, saves: null, shares: null, views: null, ...over };
}

describe("formats and local time", () => {
  it("maps Instagram's media types to formats", () => {
    assert.equal(formatOf("VIDEO", "REELS"), "reel");
    assert.equal(formatOf("VIDEO", null), "reel");
    assert.equal(formatOf("VIDEO", "FEED"), "video");
    assert.equal(formatOf("CAROUSEL_ALBUM"), "carousel");
    assert.equal(formatOf("IMAGE", "FEED"), "photo");
    assert.equal(formatOf(undefined), "photo");
  });

  it("reads weekday and hour in the business's timezone", () => {
    // 2026-10-15 is a Thursday; 20:30 UTC is 23:30 in Kuwait (UTC+3).
    assert.deepEqual(localWeekdayHour("2026-10-15T20:30:00Z", "Asia/Kuwait"), { weekday: "thu", hour: 23 });
    assert.deepEqual(localWeekdayHour("2026-10-15T22:30:00Z", "Asia/Kuwait"), { weekday: "fri", hour: 1 });
    assert.deepEqual(localWeekdayHour("2026-10-15T20:30:00Z", "Not/AZone"), { weekday: "thu", hour: 20 });
    assert.equal(dayPartOf(7), "morning");
    assert.equal(dayPartOf(13), "afternoon");
    assert.equal(dayPartOf(20), "evening");
    assert.equal(dayPartOf(23), "night");
    assert.equal(dayPartOf(3), "night");
  });

  it("counts hashtags once per post, most used first", () => {
    assert.deepEqual(hashtagCounts(["#Kuwait #q8 #kuwait", "#q8 #coffee", "#Q8"]), [
      { tag: "#q8", count: 3 },
      { tag: "#Kuwait", count: 1 },
      { tag: "#coffee", count: 1 },
    ]);
  });
});

describe("accountStats", () => {
  it("measures frequency, mix, averages, best posts, days, times and hashtags", () => {
    const posts = [
      post({ id: "a", format: "reel", likes: 300, comments: 30, postedAt: "2026-10-14T17:00:00Z", caption: "#q8 new" }),
      post({ id: "b", format: "photo", likes: 100, comments: 10, postedAt: "2026-10-12T06:00:00Z", caption: "#q8 #kuwait" }),
      post({ id: "c", format: "carousel", likes: 200, comments: 20, postedAt: "2026-10-08T17:00:00Z", caption: "" }),
      post({ id: "d", format: "reel", likes: 400, comments: 40, postedAt: "2026-10-01T17:00:00Z", caption: "#q8", reach: 5000 }),
    ];
    const s = accountStats(posts, 11_000, "Asia/Kuwait", NOW)!;
    assert.equal(s.posts, 4);
    assert.equal(s.spanDays, 14);
    assert.equal(s.postsPerWeek, 2);
    assert.deepEqual(
      s.mix.map((m) => [m.format, m.posts, m.sharePct, m.avgInteractions]),
      [
        ["reel", 2, 50, 385],
        ["carousel", 1, 25, 220],
        ["photo", 1, 25, 110],
      ],
    );
    assert.equal(s.avgInteractions, 275);
    assert.equal(s.engagementPct, 2.5);
    assert.equal(s.avgReach, 5000);
    assert.equal(s.reachPosts, 1);
    assert.deepEqual(s.best, ["d", "a", "c"]);
    // 17:00 UTC = 20:00 Kuwait (evening); 06:00 UTC = 09:00 (morning).
    assert.equal(s.usualTime, "evening");
    assert.deepEqual(s.byDayPart, [
      { key: "morning", posts: 1, avgInteractions: 110 },
      { key: "evening", posts: 3, avgInteractions: 330 },
    ]);
    assert.equal(s.usualDay, "thu"); // Oct 1 and 8 are Thursdays, Oct 14 a Wednesday
    assert.deepEqual(s.hashtags[0], { tag: "#q8", count: 3 });
    assert.equal(s.hashtagsPerPost, 1);
  });

  it("has no stats without posts and no engagement % without followers", () => {
    assert.equal(accountStats([], 100, "UTC"), null);
    assert.equal(accountStats([post()], null, "UTC")!.engagementPct, null);
  });

  it("compares the business with a competitor on measured numbers only", () => {
    const you = accountStats([post({ likes: 90, comments: 10 }), post({ likes: 90, comments: 10, format: "reel" })], 1000, "UTC", NOW)!;
    const them = accountStats([post({ likes: 900, comments: 100 }), post({ likes: 900, comments: 100 }), post({ likes: 900, comments: 100 })], 50_000, "UTC", NOW)!;
    const c = Object.fromEntries(compareAccounts(you, them).map((x) => [x.metric, x]));
    // They get more likes in total, but per follower the business does better.
    assert.equal(c.avgInteractions.ahead, "them");
    assert.equal(c.engagementPct.ahead, "you");
    assert.equal(c.reelShare.ahead, "you");
    assert.equal(c.hashtagsPerPost.ahead, null);
    assert.equal(compareAccounts(null, them)[0].ahead, null);
  });
});

describe("weekly growth from snapshots", () => {
  it("keeps the latest snapshot per week and the change over the span", () => {
    const g = weeklyGrowth([
      { takenAt: "2026-09-28T10:00:00Z", followers: 1000, engagementRate: 2 },
      { takenAt: "2026-09-30T10:00:00Z", followers: 1010, engagementRate: 2.1 },
      { takenAt: "2026-10-06T10:00:00Z", followers: 1050, engagementRate: 2.2 },
      { takenAt: "2026-10-13T10:00:00Z", followers: 1100, engagementRate: 2.4 },
    ]);
    assert.deepEqual(g.points.map((p) => p.followers), [1010, 1050, 1100]);
    assert.equal(g.weeks, 3);
    assert.equal(g.changePct, 8.9);
    assert.equal(weeklyGrowth([{ takenAt: "2026-10-13T10:00:00Z", followers: 5, engagementRate: 1 }]).changePct, null);
  });

  it("fingerprints are stable and change with the data", () => {
    assert.equal(fingerprint({ a: 1, b: [2] }), fingerprint({ a: 1, b: [2] }));
    assert.notEqual(fingerprint({ a: 1 }), fingerprint({ a: 2 }));
  });
});

describe("marketing methods", () => {
  it("guesses the method from the caption in English and Arabic", () => {
    assert.equal(ruleMethod("Giveaway: comment to win a gift box!"), "giveaway");
    assert.equal(ruleMethod("سحب على هدية 🎁"), "giveaway");
    assert.equal(ruleMethod("Weekend special — 15% off everything"), "offer");
    assert.equal(ruleMethod("عرض خاص لنهاية الأسبوع"), "offer");
    assert.equal(ruleMethod("خلف الكواليس: هذا اللي نسويه كل صباح"), "behind_the_scenes");
    assert.equal(ruleMethod("Fresh from the kitchen with @chef.noura"), "collaboration");
    assert.equal(ruleMethod("Grand opening of our new branch!"), "announcement");
    assert.equal(ruleMethod("Our bestseller is back in stock"), "product");
    assert.equal(ruleMethod(""), "other");
  });

  it("ignores the business's own handle and emails when finding mentions", () => {
    assert.deepEqual(mentionsIn("Thanks @dallabean.kw and @sweet.layers!", "dallabean.kw"), ["sweet.layers"]);
    assert.deepEqual(mentionsIn("mail hello@shop.kw"), []);
    assert.equal(ruleMethod("Order at hello@shop.kw", ""), "product");
  });

  it("ranks methods with enough posts first, always with the post count", () => {
    const c = (method: ClassifiedPost["method"], likes: number, promoted = false, reach: number | null = null): ClassifiedPost => ({ ...post({ likes, comments: 0, reach }), method, promoted });
    const posts = [c("giveaway", 900), c("offer", 300), c("offer", 300), c("offer", 300, false, 1000), c("product", 100), c("product", 100), c("product", 100)];
    const ranking = rankMethods(posts);
    assert.deepEqual(
      ranking.map((r) => [r.method, r.posts, r.enoughData]),
      [
        ["offer", 3, true],
        ["product", 3, true],
        ["giveaway", 1, false],
      ],
    );
    assert.equal(ranking[0].avgReach, 1000);
    assert.equal(ranking[0].reachPosts, 1);
    // Average of all posts is 300: offer is at the average, product 66.7% below.
    assert.equal(ranking[0].vsAveragePct, 0);
    assert.equal(ranking[1].vsAveragePct, -66.7);
    assert.ok(ranking.every((r) => METHODS.includes(r.method)));
  });

  it("compares promoted with normal posts, and says when there's too little data", () => {
    const c = (likes: number, promoted: boolean): ClassifiedPost => ({ ...post({ likes, comments: 0 }), method: "product", promoted });
    const few = promotedVsOrganic([c(400, true), c(100, false)]);
    assert.equal(few.diffPct, 300);
    assert.equal(few.enoughData, false);
    const enough = promotedVsOrganic([c(400, true), c(200, true), c(100, false), c(100, false), c(100, false)]);
    assert.equal(enough.diffPct, 200);
    assert.equal(enough.enoughData, true);
    assert.equal(promotedVsOrganic([c(100, false)]).diffPct, null);
  });

  it("estimates a competitor's method mix from captions", () => {
    const mix = methodMix([post({ caption: "Giveaway time" }), post({ caption: "20% off" }), post({ caption: "50% off today" })]);
    assert.deepEqual(mix.map((m) => [m.method, m.posts]), [["offer", 2], ["giveaway", 1]]);
  });
});

describe("post performance", () => {
  it("compares each metric with the average of the posts that report it", () => {
    const target = post({ id: "t", likes: 300, comments: 30, reach: 6000, saves: 40 });
    const others = [post({ likes: 100, comments: 10, reach: 2000, saves: 0 }), post({ likes: 200, comments: 20, reach: null }), target];
    const vs = Object.fromEntries(postVsAverage(target, others).map((m) => [m.metric, m]));
    assert.deepEqual(vs.likes, { metric: "likes", value: 300, average: 150, vsAveragePct: 100, basedOn: 2 });
    assert.equal(vs.reach.average, 2000);
    assert.equal(vs.reach.basedOn, 1);
    // A 0 saves isn't a reported value: no average to compare with.
    assert.equal(vs.saves.average, null);
    assert.equal(vs.saves.vsAveragePct, null);
    assert.equal(vs.shares, undefined); // not reported for the post itself
  });

  it("builds the daily series and the growth over it", () => {
    const s = postSeries([
      { date: "2026-10-12", likes: 10, comments: 1, reach: 100, saves: null, shares: null, views: null },
      { date: "2026-10-14", likes: 40, comments: 4, reach: 700, saves: null, shares: null, views: null },
      { date: "2026-10-13", likes: 30, comments: 3, reach: 500, saves: null, shares: null, views: null },
    ]);
    assert.deepEqual(s.points.map((p) => p.date), ["2026-10-12", "2026-10-13", "2026-10-14"]);
    assert.deepEqual(s.growth, { likes: 30, comments: 3, reach: 600, interactions: 33 });
    assert.deepEqual(postSeries([]).growth, {});
  });

  it("compares the recent posts with each other", () => {
    const posts = [10, 20, 30, 40, 50, 60].map((likes, i) => post({ id: `r${i}`, likes, comments: 0, postedAt: new Date(NOW - i * DAY).toISOString() }));
    const r = recentSummary(posts, 4);
    assert.deepEqual(r.posts.map((p) => p.id), ["r0", "r1", "r2", "r3"]);
    assert.equal(r.avgInteractions, 25);
    assert.equal(r.best, "r3");
    assert.equal(r.weakest, "r0");
    assert.deepEqual(r.posts.map((p) => p.rank), [4, 3, 2, 1]);
    assert.equal(r.posts[0].vsAveragePct, -60);
    // Newest two average 15, older two 35.
    assert.equal(r.trendPct, -57.1);
    assert.equal(recentSummary(posts.slice(0, 3)).trendPct, null);
  });
});

describe("mock posts (demo data)", () => {
  it("are stable and carry formats, shares and captions with signals", () => {
    const a = generatedMedia("demo", 12, NOW);
    assert.deepEqual(a, generatedMedia("demo", 12, NOW));
    assert.ok(a.some((m) => m.format === "reel") && a.some((m) => m.format === "carousel") && a.some((m) => m.format === "photo"));
    assert.ok(a.every((m) => typeof m.shares === "number"));
    const details = mockCompetitorPostDetails("rawda.coffee", 0, 4, NOW);
    assert.ok(Date.parse(details.postedAt) < NOW);
    assert.ok(details.caption.length > 0);
  });

  it("grow quickly after posting, then level off", () => {
    assert.ok(growthShare(0) < growthShare(1));
    assert.ok(growthShare(1) < growthShare(5));
    assert.ok(growthShare(30) > 0.99 && growthShare(30) <= 1);
  });
});
