import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NOTIFICATION_SETTINGS, NOTIFICATION_TYPES, notificationRelevant } from "../../lib/notifications";
import type { AssistantPost } from "../../lib/services/text/assistant";
import { TextGenerationError } from "../../lib/services/text/errors";
import { reportSummaryPrompt } from "../../lib/services/text/prompts";
import {
  compare,
  computeWeeklyNumbers,
  followerChange,
  formatReportNumbers,
  numbersIn,
  parseReportSummary,
  reportPeriod,
  summaryUsesOnlyGivenNumbers,
} from "../../lib/services/text/report";

// Report run on Wed 2026-10-14 10:00 UTC → this week = Oct 7–13, previous = Sep 30 – Oct 6.
const NOW = new Date("2026-10-14T10:00:00Z");
const post = (postedAt: string, likes: number, comments: number, reach = 0, type: "image" | "video" = "image"): AssistantPost => ({ postedAt, type, caption: `Post ${postedAt.slice(5, 10)}`, likes, comments, reach, saves: 0 });
const POSTS = [
  post("2026-10-13T18:00:00Z", 120, 20, 1500, "video"), // this week
  post("2026-10-09T18:00:00Z", 60, 10, 900), // this week
  post("2026-10-08T09:00:00Z", 30, 0, 600), // this week
  post("2026-10-05T18:00:00Z", 50, 10, 1000), // previous
  post("2026-10-01T18:00:00Z", 30, 10, 800), // previous
  post("2026-09-29T18:00:00Z", 999, 99, 9999), // older: ignored
];
const SERIES = Array.from({ length: 20 }, (_, i) => {
  const date = new Date(Date.UTC(2026, 8, 25 + i)).toISOString().slice(0, 10); // Sep 25 … Oct 14
  return { date, followers: 1000 + i * 10 };
});

describe("Weekly report numbers", () => {
  it("compares complete days: the 7 days before the report day with the 7 before those", () => {
    const p = reportPeriod(NOW);
    assert.equal(new Date(p.end).toISOString(), "2026-10-14T00:00:00.000Z");
    assert.equal(new Date(p.start).toISOString(), "2026-10-07T00:00:00.000Z");
    assert.equal(new Date(p.previousStart).toISOString(), "2026-09-30T00:00:00.000Z");
  });

  it("computes posts, reach, interactions, engagement, followers, top and weakest in code", () => {
    const n = computeWeeklyNumbers({ posts: POSTS, followerSeries: SERIES, followers: 2000, demo: false, now: NOW });
    assert.deepEqual(n.posts, { current: 3, previous: 2, changePct: 50 });
    assert.deepEqual(n.reach, { current: 3000, previous: 1800, changePct: 66.7 });
    assert.deepEqual(n.avgInteractions, { current: 80, previous: 50, changePct: 60 });
    assert.deepEqual(n.engagementRate, { current: 4, previous: 2.5, changePct: 60 });
    // Oct 6 → Oct 13 = 7 days × 10; Sep 29 → Oct 6 likewise.
    assert.deepEqual(n.followerChange, { current: 70, previous: 70, changePct: 0 });
    assert.equal(n.top?.postedAt, "2026-10-13T18:00:00Z");
    assert.equal(n.weakest?.postedAt, "2026-10-08T09:00:00Z");
    assert.deepEqual(n.quality, { demo: false, thin: false });
  });

  it("is honest about thin and missing data", () => {
    const thin = computeWeeklyNumbers({ posts: POSTS.slice(0, 1), followerSeries: [], followers: null, demo: true, now: NOW });
    assert.deepEqual(thin.quality, { demo: true, thin: true });
    assert.deepEqual(thin.posts, { current: 1, previous: 0, changePct: null });
    assert.equal(thin.weakest, null);
    assert.deepEqual(thin.engagementRate, { current: null, previous: null, changePct: null });
    assert.deepEqual(thin.followerChange, { current: null, previous: null, changePct: null });
    // No reach reported for a week that has posts → no data, not 0.
    const noReach = computeWeeklyNumbers({ posts: [post("2026-10-10T10:00:00Z", 5, 1)], followerSeries: [], followers: 100, demo: false, now: NOW });
    assert.equal(noReach.reach.current, null);
    assert.equal(noReach.reach.previous, 0);
    assert.deepEqual(compare(5, 0), { current: 5, previous: 0, changePct: null });
    assert.equal(followerChange(SERIES, Date.UTC(2026, 8, 1), Date.UTC(2026, 8, 10)), null);
  });

  it("formats the numbers for the AI with the data-quality labels", () => {
    const text = formatReportNumbers(computeWeeklyNumbers({ posts: POSTS, followerSeries: SERIES, followers: 2000, demo: true, now: NOW }));
    assert.match(text, /Week: 2026-10-07 to 2026-10-14/);
    assert.match(text, /demo data, not the business's real account/);
    assert.match(text, /Posts: 3 this week vs 2 the week before \(\+50%\)/);
    assert.match(text, /Engagement rate .*: 4% this week vs 2\.5% the week before \(\+60%\)/);
    assert.match(text, /Top post: 2026-10-13 video: 120 likes, 20 comments, reach 1500/);
  });
});

describe("Weekly report summary", () => {
  const data = formatReportNumbers(computeWeeklyNumbers({ posts: POSTS, followerSeries: SERIES, followers: 2000, demo: false, now: NOW }));

  it("reads numbers in English and Arabic text", () => {
    assert.deepEqual(numbersIn("Reach 3,000 (+66.7%) over 7 days"), [3000, 66.7, 7]);
    assert.deepEqual(numbersIn("الوصول ٣٠٠٠ بزيادة ٦٦٫٧٪"), [3000, 66.7]);
  });

  it("accepts summaries that only use the given numbers (rounded is fine)", () => {
    assert.ok(summaryUsesOnlyGivenNumbers("You posted 3 times, reach rose 67% to 3,000.", data));
    assert.ok(summaryUsesOnlyGivenNumbers("نشرتم ٣ منشورات وارتفع الوصول إلى ٣٠٠٠.", data));
    assert.ok(!summaryUsesOnlyGivenNumbers("Reach rose to 4,500.", data));
  });

  it("rejects an invented number, so the report goes out with numbers only", () => {
    const ok = parseReportSummary(JSON.stringify({ summary_en: "A good week: 3 posts and more reach.", summary_ar: "أسبوع جيد: ٣ منشورات ووصول أعلى." }), data);
    assert.equal(ok.en, "A good week: 3 posts and more reach.");
    assert.throws(
      () => parseReportSummary(JSON.stringify({ summary_en: "Reach jumped 250%.", summary_ar: "قفز الوصول ٢٥٠٪." }), data),
      (e: TextGenerationError) => e.reason === "bad_output" && /numbers that aren't in the data/.test(e.message),
    );
    assert.throws(() => parseReportSummary("not json", data), (e: TextGenerationError) => e.reason === "bad_output");
  });

  it("prompt: only the given numbers, honest about demo and thin data, both languages", () => {
    const p = reportSummaryPrompt({ businessName: "Mathanet Baity", businessNameAr: "مطحنة بيتي", numbers: data });
    assert.match(p.system, /Use only the numbers in <week_numbers>/);
    assert.match(p.system, /If the data is demo data, say so/);
    assert.match(p.system, /don't claim causes/);
    assert.match(p.system, /<week_numbers>\nWeek: 2026-10-07/);
    assert.ok(p.schema);
  });
});

describe("Notification types", () => {
  it("every type has a preference and a page; settings only list relevant ones", () => {
    for (const def of Object.values(NOTIFICATION_TYPES)) assert.ok(def.pref && def.href.startsWith("/"));
    const on = new Set(["recommendations", "reports", "engagement", "engagement.aiReplies"]);
    const enabled = (key: string) => on.has(key);
    const shown = NOTIFICATION_SETTINGS.filter((s) => notificationRelevant(s.features, enabled)).map((s) => s.pref);
    // No scheduling feature → no "scheduled posts" switch; Instagram reconnect is always relevant.
    assert.deepEqual(shown, ["recommendationsReady", "weeklyReport", "approvalNeeded", "instagramReconnect"]);
  });
});
