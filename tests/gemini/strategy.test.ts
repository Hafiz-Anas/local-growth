import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatFacts, postStats, weekdayOf, type AssistantFacts, type AssistantPost } from "../../lib/services/text/assistant";
import { TextGenerationError } from "../../lib/services/text/errors";
import { strategyPrompt } from "../../lib/services/text/prompts";
import {
  cappedConfidence,
  compareOutcome,
  outcomeBaseline,
  outcomeSummary,
  parseStrategy,
  strategyInputHash,
  type StrategyDecision,
} from "../../lib/services/text/strategy";

const post = (postedAt: string, likes: number, comments: number, extra: Partial<AssistantPost> = {}): AssistantPost => ({ postedAt, type: "image", caption: "Fresh cashews", likes, comments, reach: 0, saves: 0, ...extra });

const facts = (overrides: Partial<AssistantFacts> = {}): AssistantFacts => ({
  business: { name: "Mathanet Baity", nameAr: "مطحنة بيتي", type: "roastery", location: "Shuwaikh", description: null, products: [], targetAudience: null, languages: ["ar", "en"], timezone: "Asia/Kuwait", focus: { niche: null, aim: null, goals: [], timeline: null } },
  brand: { summary: null, captionStyle: null, postTypes: [], toneLevel: 50, wordsToUse: [], wordsToAvoid: [], hashtags: ["#mathanet_baity"] },
  instagram: { status: "connected", username: "mathanet_baity", lastSyncAt: "2026-10-14T06:00:00.000Z" },
  profile: { followers: 2000, following: 10, posts: 50 },
  posts: [
    // 2026-10-15 is a Thursday; 19:00 UTC is 22:00 in Kuwait, still Thursday.
    post("2026-10-15T19:00:00Z", 120, 10, { type: "video", reach: 1500 }),
    post("2026-10-08T19:00:00Z", 100, 10, { type: "video", reach: 1300 }),
    post("2026-10-06T09:00:00Z", 40, 2, { reach: 700 }),
  ],
  ...overrides,
});

const answer = (items: unknown[]) => JSON.stringify({ recommendations: items });
const item = (o: Record<string, unknown> = {}) => ({
  action_en: "Post a Reel on Thursday evening",
  action_ar: "انشروا ريل مساء الخميس",
  rationale_en: "Your 2 Thursday Reels averaged 120 likes+comments vs 42 for other posts. A pattern in 3 posts, not proof.",
  rationale_ar: "حقق الريلز يوم الخميس متوسط ١٢٠ تفاعلاً مقابل ٤٢. نمط في ٣ منشورات وليس دليلاً.",
  category: "timing",
  metric: "interactions",
  confidence: "strong",
  based_on_posts: 12,
  ...o,
});

describe("Strategy data", () => {
  it("adds weekday figures in the business's timezone", () => {
    assert.equal(weekdayOf("2026-10-15T22:30:00Z", "Asia/Kuwait"), "Fri"); // 01:30 Friday in Kuwait
    assert.equal(weekdayOf("2026-10-15T22:30:00Z", "Not/AZone"), "Thu"); // unknown zone → UTC
    const stats = postStats(facts().posts!, 2000, "Asia/Kuwait")!;
    assert.deepEqual(stats.byWeekday, [
      { day: "Tue", posts: 1, avgInteractions: 42, avgReach: 700 },
      { day: "Thu", posts: 2, avgInteractions: 120, avgReach: 1400 },
    ]);
    const text = formatFacts(facts(), "strategy");
    assert.match(text, /By weekday \(Asia\/Kuwait\): Tue 42 likes\+comments, reach 700 \(1 post\); Thu 120 likes\+comments, reach 1400 \(2 posts\)/);
    assert.match(text, /2026-10-15 \(Thu\) video: 120 likes/);
    assert.match(text, /Account metrics|Recent posts/);
  });

  it("strategy scope includes competitors only when they were loaded", () => {
    assert.doesNotMatch(formatFacts(facts(), "strategy"), /Tracked competitors/);
    assert.match(formatFacts(facts({ competitors: [] }), "strategy"), /Tracked competitors \(0\)/);
  });
});

describe("Strategy answers", () => {
  it("parses up to 5 complete, distinct recommendations", () => {
    const recs = parseStrategy(answer([item(), item(), item({ action_en: "Reply to every comment within an hour", category: "engagement", metric: "reach" }), item({ action_ar: "" }), ...Array.from({ length: 6 }, (_, i) => item({ action_en: `Idea ${i}` }))]));
    assert.equal(recs.length, 5);
    assert.deepEqual(recs.map((r) => r.actionEn).slice(0, 3), ["Post a Reel on Thursday evening", "Reply to every comment within an hour", "Idea 0"]);
    assert.equal(recs[1].category, "engagement");
    assert.equal(recs[1].metric, "reach");
  });

  it("caps the confidence by the number of posts", () => {
    assert.equal(cappedConfidence("strong", 12), "strong");
    assert.equal(cappedConfidence("strong", 7), "moderate");
    assert.equal(cappedConfidence("moderate", 3), "early");
    assert.equal(cappedConfidence("strong", 0), "early");
    assert.equal(parseStrategy(answer([item({ based_on_posts: 3 })]))[0].confidence, "early");
  });

  it("unknown enums fall back safely; nothing usable is bad_output", () => {
    const [rec] = parseStrategy("```json\n" + answer([item({ category: "virality", metric: "sales", confidence: "certain", based_on_posts: "lots" })]) + "\n```");
    assert.deepEqual([rec.category, rec.metric, rec.confidence, rec.basedOnPosts], ["content", "interactions", "early", 0]);
    assert.throws(() => parseStrategy("Here are some ideas"), (e: TextGenerationError) => e.reason === "bad_output");
    assert.throws(() => parseStrategy(answer([item({ rationale_en: " " })])), (e: TextGenerationError) => e.reason === "bad_output");
  });
});

describe("Strategy cache and prompt", () => {
  it("the hash ignores the sync time but not data or decisions", () => {
    const base = strategyInputHash(facts(), []);
    assert.equal(strategyInputHash(facts({ instagram: { status: "connected", username: "mathanet_baity", lastSyncAt: "2026-10-20T06:00:00.000Z" } }), []), base);
    assert.notEqual(strategyInputHash(facts({ profile: { followers: 2001, following: 10, posts: 50 } }), []), base);
    // Post times moved by seconds on the same day (demo data is dated relative to "now").
    const shifted = facts().posts!.map((p) => ({ ...p, postedAt: new Date(Date.parse(p.postedAt) + 1234).toISOString() }));
    assert.equal(strategyInputHash(facts({ posts: shifted }), []), base);
    assert.notEqual(strategyInputHash(facts(), [{ status: "dismissed", at: "2026-10-10T00:00:00.000Z", action: "Run a giveaway" }]), base);
  });

  it("feeds past decisions in, so dismissed ideas aren't repeated", () => {
    const decisions: StrategyDecision[] = [
      { status: "dismissed", at: "2026-10-10T08:00:00.000Z", action: "Run a giveaway" },
      { status: "done", at: "2026-10-01T08:00:00.000Z", action: "Post at 21:00", outcome: "reach +14% (up)" },
    ];
    const p = strategyPrompt({ businessName: "Mathanet Baity", businessNameAr: "مطحنة بيتي", facts: formatFacts(facts(), "strategy"), decisions });
    assert.match(p.system, /<past_decisions>\n- DISMISSED on 2026-10-10: Run a giveaway\n- DONE on 2026-10-01: Post at 21:00 — outcome: reach \+14% \(up\)\n<\/past_decisions>/);
    assert.match(p.system, /never repeat or rephrase a DISMISSED idea/);
    assert.match(p.system, /correlation, not causation/);
    assert.match(p.system, /Never invent numbers/);
    assert.ok(p.schema);
    assert.match(strategyPrompt({ businessName: "X", businessNameAr: null, facts: "", decisions: [] }).system, /<past_decisions>\nNone yet\.\n<\/past_decisions>/);
  });
});

describe("Outcomes", () => {
  const done = new Date("2026-10-15T12:00:00Z");
  const before = [post("2026-10-03T10:00:00Z", 50, 5, { reach: 800 }), post("2026-10-10T10:00:00Z", 30, 5, { reach: 600 }), post("2026-09-20T10:00:00Z", 999, 9, { reach: 9999 })];

  it("baseline: the 14 days before Done", () => {
    assert.deepEqual(outcomeBaseline(before, 2000, done), { at: done.toISOString(), posts: 2, avgReach: 700, avgInteractions: 45, followers: 2000 });
  });

  it("reports up, down, no clear change and not enough data honestly", () => {
    const baseline = outcomeBaseline(before, 2000, done);
    const check = new Date("2026-10-23T12:00:00Z");
    const after = (reach: number) => [post("2026-10-17T10:00:00Z", 60, 6, { reach }), post("2026-10-20T10:00:00Z", 40, 4, { reach }), post("2026-10-25T10:00:00Z", 999, 9, { reach: 99999 })];

    const up = compareOutcome("reach", baseline, [...before, ...after(1000)], 2050, check);
    assert.deepEqual([up.verdict, up.before, up.after, up.changePct, up.postsBefore, up.postsAfter], ["up", 700, 1000, 42.9, 2, 2]);
    assert.equal(compareOutcome("reach", baseline, after(500), 2050, check).verdict, "down");
    const flat = compareOutcome("interactions", baseline, after(700), 2050, check);
    assert.deepEqual([flat.verdict, flat.before, flat.after, flat.changePct], ["up", 45, 55, 22.2]);
    assert.equal(compareOutcome("reach", baseline, after(740), 2050, check).verdict, "no_clear_change");
    assert.equal(compareOutcome("reach", baseline, [post("2026-10-17T10:00:00Z", 1, 1, { reach: 5000 })], 2050, check).verdict, "not_enough_data");
    assert.equal(compareOutcome("reach", outcomeBaseline([], 2000, done), after(1000), 2050, check).verdict, "not_enough_data");
  });

  it("followers compare the count at Done with the count at the check", () => {
    const baseline = outcomeBaseline(before, 2000, done);
    const now = new Date("2026-10-23T12:00:00Z");
    assert.equal(compareOutcome("followers", baseline, [], 2010, now).verdict, "no_clear_change");
    const grew = compareOutcome("followers", baseline, [], 2100, now);
    assert.deepEqual([grew.verdict, grew.changePct], ["up", 5]);
    assert.equal(outcomeSummary(grew), "followers +5% (up)");
    assert.equal(compareOutcome("followers", { ...baseline, followers: null }, [], 2100, now).verdict, "not_enough_data");
  });
});
