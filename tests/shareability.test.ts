import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AnalysisPost } from "../lib/analysis/posts";
import {
  MOST_SHARED_COUNT,
  SHARE_MIN_POSTS,
  SHARE_MIN_POSTS_FOR_PATTERNS,
  SHARE_MIN_REACH,
  computeShareability,
  postShareRate,
  ratePct,
  sharePatterns,
  shareRate,
  timesAverage,
} from "../lib/analysis/shareability";
import { summaryUsesOnlyGivenNumbers } from "../lib/services/text/report";
import { mockShareFindings, parseShareFindings, shareabilityDataBlock, shareabilityFactLines } from "../lib/services/text/shareability";
import { STRATEGY_CATEGORIES } from "../lib/services/text/strategy";
import { generatedMedia } from "../mock-data/posts";

const NOW = Date.parse("2026-10-15T12:00:00Z"); // a Thursday
const DAY = 24 * 60 * 60 * 1000;
let n = 0;
const post = (over: Partial<AnalysisPost> = {}): AnalysisPost => {
  n += 1;
  return { id: `p${n}`, caption: "", format: "photo", postedAt: new Date(NOW - n * DAY).toISOString(), likes: 90, comments: 10, reach: 1000, saves: 10, shares: 10, views: null, ...over };
};
const TZ = "Asia/Kuwait";

describe("share rate = shares ÷ reach", () => {
  it("divides shares by reach", () => {
    assert.deepEqual(shareRate({ shares: 25, reach: 1000 }), { status: "ok", rate: 0.025 });
    assert.deepEqual(shareRate({ shares: 0, reach: 800 }), { status: "ok", rate: 0 });
    assert.equal(ratePct(25 / 1000), 2.5);
    assert.equal(ratePct(7 / 1500), 0.47);
  });

  it("leaves out posts reached by fewer than the minimum, but not at the minimum", () => {
    assert.equal(SHARE_MIN_REACH, 100);
    assert.deepEqual(shareRate({ shares: 5, reach: SHARE_MIN_REACH - 1 }), { status: "low_reach", rate: null });
    assert.deepEqual(shareRate({ shares: 5, reach: SHARE_MIN_REACH }), { status: "ok", rate: 5 / SHARE_MIN_REACH });
  });

  it("has no rate when Instagram sent no shares or no reach (never a made-up zero)", () => {
    assert.equal(shareRate({ shares: null, reach: 1000 }).status, "unavailable");
    assert.equal(shareRate({ shares: 4, reach: null }).status, "unavailable");
    assert.equal(shareRate({ shares: 4, reach: 0 }).status, "unavailable");
  });

  it("compares with the average as \"times\", one decimal", () => {
    assert.equal(timesAverage(0.03, 0.01), 3);
    assert.equal(timesAverage(0.0125, 0.01), 1.3);
    assert.equal(timesAverage(0.005, 0.01), 0.5);
    assert.equal(timesAverage(0.02, null), null);
    assert.equal(timesAverage(0.02, 0), null);
  });
});

describe("computeShareability", () => {
  it("pools the average (all shares ÷ all reach) and ranks the posts, most shared first", () => {
    const posts = [post({ shares: 10, reach: 1000 }), post({ shares: 60, reach: 2000 }), post({ shares: 2, reach: 400 }), post({ shares: 20, reach: 1000 })];
    const data = computeShareability(posts, { timeZone: TZ });
    assert.equal(data.posts, 4);
    assert.equal(data.totalShares, 92);
    assert.equal(data.totalReach, 4400);
    assert.equal(data.averagePct, ratePct(92 / 4400)); // 2.09, not the mean of the rates
    assert.deepEqual(data.ranked.map((p) => p.ratePct), [3, 2, 1, 0.5]);
    assert.equal(data.ranked[0].vsAverage, 1.4);
    assert.equal(data.mostShared.length, Math.min(MOST_SHARED_COUNT, 4));
  });

  it("leaves low-reach and no-data posts out of the average and the ranking, and counts them", () => {
    const tiny = post({ shares: 9, reach: 50 }); // 18% on 50 people: would top the list
    const none = post({ shares: null });
    const data = computeShareability([tiny, none, post({ shares: 10, reach: 1000 }), post({ shares: 20, reach: 1000 }), post({ shares: 30, reach: 1000 })], { timeZone: TZ });
    assert.deepEqual(data.excluded, { lowReach: 1, unavailable: 1 });
    assert.equal(data.posts, 3);
    assert.ok(!data.ranked.some((p) => p.id === tiny.id || p.id === none.id));
    assert.equal(data.averagePct, 2);
  });

  it("shows no average or \"Most shared\" below the minimum number of posts", () => {
    const data = computeShareability([post({ shares: 30, reach: 1000 }), post({ shares: 10, reach: 1000 })], { timeZone: TZ });
    assert.equal(SHARE_MIN_POSTS, 3);
    assert.equal(data.averagePct, null);
    assert.deepEqual(data.mostShared, []);
    assert.equal(data.ranked[0].vsAverage, null);
  });

  it("breaks ties by more shares, then the newer post", () => {
    const older = post({ shares: 10, reach: 1000, postedAt: "2026-10-01T10:00:00Z" });
    const newer = post({ shares: 10, reach: 1000, postedAt: "2026-10-05T10:00:00Z" });
    const bigger = post({ shares: 20, reach: 2000, postedAt: "2026-09-01T10:00:00Z" });
    const data = computeShareability([older, newer, bigger], { timeZone: TZ });
    assert.deepEqual(data.ranked.map((p) => p.id), [bigger.id, newer.id, older.id]);
  });

  it("groups by format, topic, day and time of day in the business's timezone", () => {
    // 2026-10-15 is a Thursday; 18:00 UTC = 21:00 in Kuwait (evening).
    const reel = post({ format: "reel", shares: 40, reach: 1000, postedAt: "2026-10-15T18:00:00Z" });
    const data = computeShareability([reel, post({ shares: 10, reach: 1000 }), post({ shares: 10, reach: 1000 })], { timeZone: TZ, topicOf: (p) => (p.id === reel.id ? "collaboration" : "product") });
    assert.equal(data.ranked[0].weekday, "thu");
    assert.equal(data.ranked[0].dayPart, "evening");
    assert.deepEqual(data.groups.format.map((g) => [g.key, g.posts, g.ratePct]), [["reel", 1, 4], ["photo", 2, 1]]);
    assert.equal(data.groups.topic[0].key, "collaboration");
  });

  it("a post's detail rate is against the same pooled average", () => {
    const posts = [post({ shares: 30, reach: 1000 }), post({ shares: 10, reach: 1000 }), post({ shares: 20, reach: 1000 }), post({ shares: 1, reach: 99 })];
    const data = computeShareability(posts, { timeZone: TZ });
    assert.deepEqual(postShareRate(posts[0], data), { status: "ok", ratePct: 3, shares: 30, reach: 1000, averagePct: 2, vsAverage: 1.5, basedOn: 3 });
    assert.equal(postShareRate(posts[3], data).status, "low_reach");
    assert.equal(postShareRate(posts[3], data).ratePct, null);
  });
});

/** Six posts: two Reels shared a lot, four photos shared little. */
function reelHeavy() {
  return computeShareability(
    [
      post({ format: "reel", shares: 45, reach: 1500, caption: "Behind the bar with @chef.noura" }),
      post({ format: "reel", shares: 36, reach: 1200, caption: "Watch how we roast" }),
      post({ shares: 8, reach: 1000 }),
      post({ shares: 9, reach: 1100 }),
      post({ shares: 6, reach: 900 }),
      post({ shares: 7, reach: 1000 }),
    ],
    { timeZone: TZ },
  );
}

describe("patterns: most- vs least-shared", () => {
  it("finds a group well above the average, backed by at least two posts", () => {
    const data = reelHeavy();
    assert.equal(data.posts, SHARE_MIN_POSTS_FOR_PATTERNS);
    assert.equal(data.top.length, 2);
    assert.equal(data.bottom.length, 2);
    const patterns = sharePatterns(data);
    assert.equal(patterns[0].dimension, "format");
    assert.equal(patterns[0].key, "reel");
    assert.equal(patterns[0].direction, "above");
    assert.ok(patterns.every((p) => p.group.posts >= 2));
  });

  it("puts post type and topic ahead of an equally strong day of the week", () => {
    const fri = "2026-10-09T15:00:00Z"; // Friday 18:00 in Kuwait
    const data = computeShareability(
      [
        post({ format: "reel", shares: 30, reach: 1000, postedAt: "2026-10-05T15:00:00Z" }),
        post({ format: "reel", shares: 30, reach: 1000, postedAt: "2026-10-06T15:00:00Z" }),
        post({ shares: 30, reach: 1000, postedAt: fri }),
        post({ shares: 30, reach: 1000, postedAt: "2026-10-02T15:00:00Z" }),
        post({ shares: 5, reach: 1000, postedAt: "2026-10-07T15:00:00Z" }),
        post({ shares: 5, reach: 1000, postedAt: "2026-10-08T15:00:00Z" }),
        post({ shares: 5, reach: 1000, postedAt: "2026-10-01T15:00:00Z" }),
      ],
      { timeZone: TZ },
    );
    const above = sharePatterns(data).filter((p) => p.direction === "above");
    assert.equal(above[0].dimension, "format");
    assert.ok(above.some((p) => p.dimension === "weekday" && p.key === "fri"));
  });

  it("looks for no patterns with too few posts", () => {
    const data = computeShareability([post({ format: "reel", shares: 50, reach: 1000 }), post({ format: "reel", shares: 50, reach: 1000 }), post(), post(), post()], { timeZone: TZ });
    assert.deepEqual(sharePatterns(data), []);
    assert.deepEqual(data.top, []);
  });
});

describe("findings", () => {
  it("the data block has every number a finding may quote", () => {
    const block = shareabilityDataBlock(reelHeavy());
    assert.match(block, /Posts reached by fewer than 100 accounts are left out/);
    assert.match(block, /Account average share rate: 1\.66% \(111 shares over a reach of 6700\)/);
    assert.match(block, /By post type: Reels 3% \(1\.8x\) over 2 posts; photos 0\.75% \(0\.5x\) over 4 posts/);
  });

  it("the mock writes 1–3 findings from the strongest patterns, using only the given numbers", () => {
    const data = reelHeavy();
    const block = shareabilityDataBlock(data);
    const findings = mockShareFindings(data);
    assert.ok(findings.length >= 1 && findings.length <= 3);
    assert.match(findings[0].en, /^Reels get shared the most: 3% of the people they reach share them, 1\.8x your average of 1\.66% \(2 posts\)/);
    assert.match(findings[0].ar, /الريلز/);
    for (const f of findings) assert.ok(summaryUsesOnlyGivenNumbers(f.en, block) && summaryUsesOnlyGivenNumbers(f.ar, block), f.en);
  });

  it("the mock writes nothing without enough posts", () => {
    assert.deepEqual(mockShareFindings(computeShareability([post(), post(), post()], { timeZone: TZ })), []);
  });

  it("parses the model's findings and rejects invented numbers or empty answers", () => {
    const block = shareabilityDataBlock(reelHeavy());
    const ok = JSON.stringify({ findings: [{ finding_en: "Reels get shared 1.8x more than average (3%, 2 posts). Post another Reel.", finding_ar: "الريلز تُشارَك أكثر (3%)." }] });
    assert.deepEqual(parseShareFindings(ok, block), [{ en: "Reels get shared 1.8x more than average (3%, 2 posts). Post another Reel.", ar: "الريلز تُشارَك أكثر (3%)." }]);
    const invented = JSON.stringify({ findings: [{ finding_en: "Reels get 47% more shares.", finding_ar: "الريلز" }] });
    assert.throws(() => parseShareFindings(invented, block), /numbers that aren't in the data/);
    assert.throws(() => parseShareFindings(JSON.stringify({ findings: [] }), block), /empty/);
    assert.throws(() => parseShareFindings("not json", block), /valid JSON/);
    const four = JSON.stringify({ findings: Array.from({ length: 4 }, () => ({ finding_en: "Reels", finding_ar: "الريلز" })) });
    assert.equal(parseShareFindings(four, block).length, 3);
  });
});

describe("weekly recommendations", () => {
  it("get the share numbers and findings as a section, and a \"shares\" category", () => {
    const data = reelHeavy();
    const lines = shareabilityFactLines(data, mockShareFindings(data));
    assert.match(lines.join("\n"), /## Shareability/);
    assert.match(lines.join("\n"), /Account average: 1\.66%/);
    assert.match(lines.join("\n"), /Findings \(written from these numbers\):\n- Reels get shared the most/);
    assert.ok(STRATEGY_CATEGORIES.includes("shares"));
  });

  it("get no section without an average", () => {
    assert.deepEqual(shareabilityFactLines(computeShareability([post()], { timeZone: TZ }), []), []);
  });
});

describe("mock posts", () => {
  it("vary their share rate by caption and format, so there is something to find", () => {
    const media = generatedMedia("mathanet_baity", 12, NOW);
    const rates = new Set(media.map((m) => Math.round(((m.shares ?? 0) / m.reach) * 1000)));
    assert.ok(rates.size >= 5);
    const giveaway = media.find((m) => m.caption.includes("Giveaway"));
    const findUs = media.find((m) => m.caption.startsWith("Find us"));
    if (giveaway && findUs) assert.ok(giveaway.shares! / giveaway.reach > findUs.shares! / findUs.reach);
  });
});
