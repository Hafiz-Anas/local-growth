import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeGrowthSignals } from "../../lib/analysis/growth-signals";
import { computeShareability } from "../../lib/analysis/shareability";
import { formatFacts, postStats, weekdayOf, type AssistantFacts, type AssistantPost } from "../../lib/services/text/assistant";
import { TextGenerationError } from "../../lib/services/text/errors";
import { strategyPrompt } from "../../lib/services/text/prompts";
import {
  STRATEGY_MAX,
  compareOutcome,
  confidenceFor,
  mockStrategyTips,
  outcomeBaseline,
  outcomeSummary,
  parseStrategy,
  quotesSignal,
  rankTips,
  signalLines,
  strategyInputHash,
  tipUsesOnlyGivenNumbers,
  type StrategyDecision,
} from "../../lib/services/text/strategy";
import { GROWTH_TZ, growthPosts } from "../fixtures/growth-posts";

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

/** The fixture's signals (s1 shares/Reels high, s2 comments/carousels, s3 saves/carousels, s4 reach/Reels, s5 Thursday evening) and their data block. */
function fixture() {
  const posts = growthPosts();
  const { signals, bestSlot } = computeGrowthSignals(posts, { timeZone: GROWTH_TZ, shareability: computeShareability(posts, { timeZone: GROWTH_TZ }) });
  return { signals, bestSlot, data: signalLines(signals, bestSlot).join("\n") };
}

const answer = (items: unknown[]) => JSON.stringify({ recommendations: items });
const tip = (o: Record<string, unknown> = {}) => ({
  signal_id: "s1",
  action_en: "Post a 15-second Reel of your kunafa being made, Thursday at 8pm",
  action_ar: "انشروا ريل مدته ١٥ ثانية للكنافة أثناء التحضير يوم الخميس الساعة ٨ مساءً",
  why_en: "Your Reels get shared most: 5% of the people they reach share them, vs 3.3% across your posts.",
  why_ar: "الريلز الأكثر مشاركة: يشاركها ٥٪ ممن تصلهم مقابل ٣٫٣٪ لكل منشوراتكم.",
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

  it("lists the growth signals with their id, numbers and expected impact", () => {
    const { data } = fixture();
    assert.match(data, /\[s1\] SHARES — Reels: 5% of the people they reach share them, vs 3\.3% for all posts \(\+52%\), over 5 posts\. Expected impact: high\./);
    assert.match(data, /\[s5\] REACH BY POSTING TIME — posts on Thursday evening \(17:00–22:00\): reach 2000 per post, vs 1450 for all posts \(\+38%\)/);
    assert.match(data, /Best time to post \(highest average reach\): Thursday evening \(17:00–22:00, suggest 20:00\)\./);
    assert.deepEqual(signalLines([], null), []);
  });
});

describe("The number check", () => {
  const data = "Reels: 5% vs 3.3% for all posts (+52%), over 5 posts. Reach 2000 per post vs 1450. Share rate 2.37%.";

  it("accepts numbers from the data, rounded, with separators or in Arabic digits", () => {
    assert.ok(tipUsesOnlyGivenNumbers("Reels reach 2,000 people vs 1,450 (+52%)", data));
    assert.ok(tipUsesOnlyGivenNumbers("Share rate 2.4% (from 2.37%), 2% rounded", data));
    assert.ok(tipUsesOnlyGivenNumbers("يشاركها ٥٪ مقابل ٣٫٣٪، والوصول ٢٬٠٠٠", data));
  });

  it("allows times, video lengths and small counts in the action", () => {
    assert.ok(tipUsesOnlyGivenNumbers("Post a 15-second Reel on Thursday at 8pm, then 2 photos at 20:00", data));
    assert.ok(tipUsesOnlyGivenNumbers("Post a 30 second video at 10:30 am and a carousel of 5 photos", data));
    assert.ok(tipUsesOnlyGivenNumbers("انشروا ريل مدته ١٥ ثانية يوم الخميس الساعة ٨ مساءً", data));
  });

  it("rejects any other number, and any percent or ratio not in the data", () => {
    assert.equal(tipUsesOnlyGivenNumbers("Reels get 35% more reach", data), false);
    assert.equal(tipUsesOnlyGivenNumbers("Reels get 4x more shares", data), false);
    assert.equal(tipUsesOnlyGivenNumbers("Reels reach 4,000 people", data), false);
    assert.equal(tipUsesOnlyGivenNumbers("You could reach 12 more customers", data), false);
    assert.equal(tipUsesOnlyGivenNumbers("الوصول ارتفع ٤٠٪", data), false);
  });

  it("the why must quote the signal itself", () => {
    const signal = { value: 5, average: 3.3, liftPct: 52 };
    assert.ok(quotesSignal("5% of people share them", signal));
    assert.ok(quotesSignal("+52% above your average", signal));
    assert.ok(quotesSignal("مقابل ٣٫٣٪", signal));
    assert.equal(quotesSignal("Reels do better over 5 posts", { value: 2000, average: 1450, liftPct: 38 }), false);
    assert.equal(quotesSignal("Reels get shared a lot", signal), false);
  });
});

describe("Strategy answers", () => {
  it("keeps tips that rest on a signal and quote its numbers; impact, metric and posts come from the signal", () => {
    const { signals, data } = fixture();
    const [t] = parseStrategy(answer([tip({ impact: "low", metric: "followers", based_on_posts: 99 })]), { data, signals });
    assert.deepEqual([t.signalId, t.impact, t.metric, t.category, t.basedOnPosts, t.confidence], ["s1", "high", "shares", "shares", 5, "moderate"]);
    assert.equal(t.actionEn, "Post a 15-second Reel of your kunafa being made, Thursday at 8pm");
    assert.match(t.rationaleEn, /5% of the people/);
  });

  it("drops tips with invented numbers, unknown or repeated signals, or a missing language", () => {
    const { signals, data } = fixture();
    const tips = parseStrategy(
      answer([
        tip({ why_en: "Reels get 80% more shares: 5% vs 3.3%." }), // 80% isn't in the data
        tip({ signal_id: "s9", why_en: "5% vs 3.3%." }), // no such signal
        tip({ signal_id: "s2", action_ar: "" }),
        tip({ signal_id: "s2", action_en: "Post a carousel of 5 photos asking for favourites", why_en: "Carousels get 20 comments per post vs 10.", why_ar: "تحصل على ٢٠ تعليقاً مقابل ١٠." }),
        tip({ signal_id: "s2", action_en: "Again", why_en: "20 comments vs 10.", why_ar: "٢٠ مقابل ١٠." }), // repeats s2
        tip({ signal_id: "s3", why_en: "Carousels are saved a lot.", why_ar: "تُحفظ كثيراً." }), // quotes no number of its signal
      ]),
      { data, signals },
    );
    assert.deepEqual(tips.map((t) => t.signalId), ["s2"]);
  });

  it("ranks by impact and keeps at most 3 tips a week", () => {
    const { signals, data } = fixture();
    const why = (s: (typeof signals)[number]) => ({ why_en: `${s.value} vs ${s.average} on average.`, why_ar: `${s.value} مقابل ${s.average}.` });
    // The model lists them weakest first; the app ranks them.
    const items = [...signals].reverse().map((s) => tip({ signal_id: s.id, action_en: `Tip on ${s.id}`, action_ar: `نصيحة ${s.id}`, ...why(s) }));
    const tips = parseStrategy(answer(items), { data, signals });
    assert.equal(tips.length, STRATEGY_MAX);
    assert.deepEqual(tips.map((t) => [t.signalId, t.impact]), [["s1", "high"], ["s2", "medium"], ["s3", "medium"]]);
  });

  it("rankTips: high before medium before low, ties in signal order", () => {
    const signals = [{ id: "s1" }, { id: "s2" }, { id: "s3" }];
    const ranked = rankTips(
      [
        { signalId: "s3", impact: "medium" as const },
        { signalId: "s2", impact: "low" as const },
        { signalId: "s1", impact: "medium" as const },
      ],
      signals,
    );
    assert.deepEqual(ranked.map((t) => t.signalId), ["s1", "s3", "s2"]);
  });

  it("nothing usable is bad_output, and says when the numbers were the problem", () => {
    const { signals, data } = fixture();
    assert.throws(() => parseStrategy("Here are some ideas", { data, signals }), (e: TextGenerationError) => e.reason === "bad_output");
    assert.throws(() => parseStrategy(answer([tip({ why_en: "Reels get 987% more shares." })]), { data, signals }), (e: TextGenerationError) => e.reason === "bad_output" && /aren't in the data/.test(e.message));
    assert.throws(() => parseStrategy(answer([]), { data, signals }), (e: TextGenerationError) => /no usable tips/.test(e.message));
    // Fenced JSON is fine.
    assert.equal(parseStrategy("```json\n" + answer([tip()]) + "\n```", { data, signals }).length, 1);
  });

  it("confidence follows the posts behind the signal", () => {
    assert.equal(confidenceFor(12), "strong");
    assert.equal(confidenceFor(7), "moderate");
    assert.equal(confidenceFor(3), "early");
  });
});

describe("Mock tips", () => {
  it("writes at most 3 specific tips for the business from its signals, every number from the data", () => {
    const { signals, bestSlot, data } = fixture();
    const tips = mockStrategyTips(signals, bestSlot, { type: "Sweets shop", products: ["Kunafa", "Maamoul"] });
    assert.equal(tips.length, 3);
    assert.deepEqual(tips.map((t) => [t.signalId, t.impact]), [["s1", "high"], ["s2", "medium"], ["s3", "medium"]]);
    // What, when and how, with their own product and best time.
    assert.equal(tips[0].actionEn, 'Post a 15-second Reel of Kunafa being made on Thursday at 8pm, ending with "Send this to someone who\'d love it"');
    assert.match(tips[1].actionEn, /carousel of 5 close-up photos of Maamoul on Thursday at 8pm/);
    for (const t of tips) assert.ok(t.actionEn.length <= 140 && t.actionAr.length <= 140, t.actionEn);
    assert.match(tips[0].actionAr, /ريل مدته 15 ثانية لـKunafa أثناء التحضير يوم الخميس الساعة 8 مساءً/);
    for (const t of tips) {
      for (const text of [t.actionEn, t.actionAr, t.rationaleEn, t.rationaleAr]) assert.ok(tipUsesOnlyGivenNumbers(text, data), text);
      const s = signals.find((x) => x.id === t.signalId)!;
      assert.ok(quotesSignal(t.rationaleEn, s) && quotesSignal(t.rationaleAr, s), t.rationaleEn);
    }
    assert.equal(tips[0].rationaleEn, "Your Reels get shared most: 5% of the people they reach send them on, vs 3.3% across your posts (5 posts).");
  });

  it("the mock's tips pass the same parser the AI's do", () => {
    const { signals, bestSlot, data } = fixture();
    const tips = mockStrategyTips(signals, bestSlot, { type: null, products: [] });
    const asJson = answer(tips.map((t) => ({ signal_id: t.signalId, action_en: t.actionEn, action_ar: t.actionAr, why_en: t.rationaleEn, why_ar: t.rationaleAr })));
    assert.deepEqual(parseStrategy(asJson, { data, signals }), tips);
    assert.match(tips[0].actionEn, /your best-seller up close/);
  });

  it("doesn't repeat what the owner dismissed, is doing or is waiting on; a measured one may come back", () => {
    const { signals, bestSlot } = fixture();
    const business = { type: "Sweets shop", products: ["Kunafa", "Maamoul"] };
    const [a, b, c] = mockStrategyTips(signals, bestSlot, business);
    const decision = (status: StrategyDecision["status"], action: string, outcome: string | null = null): StrategyDecision => ({ status, at: "2026-10-20T08:00:00.000Z", action, outcome });
    const next = mockStrategyTips(signals, bestSlot, business, [decision("dismissed", a.actionEn), decision("done", b.actionEn)]);
    assert.deepEqual(next.map((t) => t.signalId), [c.signalId, "s4", "s5"]);
    assert.equal(mockStrategyTips(signals, bestSlot, business, [decision("done", a.actionEn, "shares +30% (up)")])[0].actionEn, a.actionEn);
  });

  it("timing and reach tips say when; no signals, no tips", () => {
    const { signals, bestSlot } = fixture();
    const timing = mockStrategyTips(signals.filter((s) => s.kind === "reach_time" || s.kind === "reach_format"), bestSlot, { type: "café", products: ["Spanish latte"] });
    assert.deepEqual(timing.map((t) => t.category), ["format", "timing"]);
    assert.match(timing[0].actionEn, /^Make your next 2 posts Reels: start with a 15-second Reel of Spanish latte being made on Thursday at 8pm$/);
    assert.match(timing[1].rationaleEn, /Posts on Thursday evening reach 2,000 people on average, vs 1,450 overall \(\+38%, 5 posts\)\./);
    assert.deepEqual(mockStrategyTips([], null, { type: null, products: [] }), []);
  });
});

describe("Strategy cache and prompt", () => {
  it("the hash ignores the sync time but not data, signals or decisions", () => {
    const base = strategyInputHash(facts(), []);
    assert.equal(strategyInputHash(facts({ instagram: { status: "connected", username: "mathanet_baity", lastSyncAt: "2026-10-20T06:00:00.000Z" } }), []), base);
    assert.notEqual(strategyInputHash(facts({ profile: { followers: 2001, following: 10, posts: 50 } }), []), base);
    // Post times moved by seconds on the same day (demo data is dated relative to "now").
    const shifted = facts().posts!.map((p) => ({ ...p, postedAt: new Date(Date.parse(p.postedAt) + 1234).toISOString() }));
    assert.equal(strategyInputHash(facts({ posts: shifted }), []), base);
    assert.notEqual(strategyInputHash(facts(), [{ status: "dismissed", at: "2026-10-10T00:00:00.000Z", action: "Run a giveaway" }]), base);
    assert.notEqual(strategyInputHash(facts(), [], fixture().signals), base);
  });

  it("asks for at most 3 specific, numbered tips and feeds past decisions in", () => {
    const decisions: StrategyDecision[] = [
      { status: "dismissed", at: "2026-10-10T08:00:00.000Z", action: "Run a giveaway" },
      { status: "done", at: "2026-10-01T08:00:00.000Z", action: "Post at 21:00", outcome: "reach +14% (up)" },
    ];
    const p = strategyPrompt({ businessName: "Mathanet Baity", businessNameAr: "مطحنة بيتي", facts: formatFacts(facts(), "strategy"), decisions });
    assert.match(p.system, /<past_decisions>\n- DISMISSED on 2026-10-10: Run a giveaway\n- DONE on 2026-10-01: Post at 21:00 — outcome: reach \+14% \(up\)\n<\/past_decisions>/);
    assert.match(p.system, /never repeat or rephrase a DISMISSED idea/);
    assert.match(p.system, /Write at most 3 tips/);
    assert.match(p.system, /Never generic advice like "post more videos"/);
    assert.match(p.system, /Never invent numbers/);
    assert.match(p.system, /products or menu/);
    assert.ok(p.schema);
    assert.match(strategyPrompt({ businessName: "X", businessNameAr: null, facts: "", decisions: [] }).system, /<past_decisions>\nNone yet\.\n<\/past_decisions>/);
  });
});

describe("Outcomes", () => {
  const done = new Date("2026-10-15T12:00:00Z");
  const before = [post("2026-10-03T10:00:00Z", 50, 5, { reach: 800 }), post("2026-10-10T10:00:00Z", 30, 5, { reach: 600 }), post("2026-09-20T10:00:00Z", 999, 9, { reach: 9999 })];

  it("baseline: the 14 days before Done", () => {
    assert.deepEqual(outcomeBaseline(before, 2000, done), { at: done.toISOString(), posts: 2, avgReach: 700, avgInteractions: 45, avgComments: 5, avgSaves: 0, avgShares: null, followers: 2000 });
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

  it("measures shares, saves and comments per post; missing numbers are not enough data", () => {
    const check = new Date("2026-10-23T12:00:00Z");
    const withShares = (d: string, shares: number, saves: number) => ({ postedAt: d, likes: 10, comments: 3, reach: 900, saves, shares });
    const baseline = outcomeBaseline([withShares("2026-10-05T10:00:00Z", 10, 20), withShares("2026-10-08T10:00:00Z", 10, 20)], 2000, done);
    const afterPosts = [withShares("2026-10-17T10:00:00Z", 13, 30), withShares("2026-10-19T10:00:00Z", 13, 30)];
    const shares = compareOutcome("shares", baseline, afterPosts, 2000, check);
    assert.deepEqual([shares.verdict, shares.before, shares.after, shares.changePct], ["up", 10, 13, 30]);
    assert.equal(outcomeSummary(shares), "shares +30% (up)");
    assert.deepEqual([compareOutcome("saves", baseline, afterPosts, 2000, check).changePct, compareOutcome("comments", baseline, afterPosts, 2000, check).verdict], [50, "no_clear_change"]);
    // A baseline stored before shares were measured.
    const old = { at: done.toISOString(), posts: 2, avgReach: 900, avgInteractions: 13, followers: 2000 };
    assert.equal(compareOutcome("shares", old, afterPosts, 2000, check).verdict, "not_enough_data");
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
