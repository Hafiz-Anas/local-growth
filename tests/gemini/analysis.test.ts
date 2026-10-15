import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { accountStats, compareAccounts, type AnalysisPost } from "../../lib/analysis/posts";
import {
  classifyDataBlock,
  competitorDataBlock,
  parseClassification,
  parseCompetitorInsight,
  parsePostInsight,
  postDataBlock,
  statsLines,
} from "../../lib/services/text/analysis";
import { classifyPostsPrompt, competitorInsightPrompt, postInsightPrompt } from "../../lib/services/text/prompts";
import { TextGenerationError } from "../../lib/services/text/errors";

const NOW = Date.parse("2026-10-15T12:00:00Z");
const post = (id: string, over: Partial<AnalysisPost> = {}): AnalysisPost => ({
  id,
  caption: "#q8",
  format: "reel",
  postedAt: "2026-10-14T17:00:00Z",
  likes: 120,
  comments: 8,
  reach: null,
  saves: null,
  shares: null,
  views: null,
  ...over,
});

const you = accountStats([post("a"), post("b", { format: "photo", likes: 80, comments: 4 })], 2000, "Asia/Kuwait", NOW)!;
const them = accountStats([post("c", { likes: 900, comments: 60 }), post("d", { likes: 700, comments: 40 }), post("e", { format: "carousel", likes: 500, comments: 20 })], 30000, "Asia/Kuwait", NOW)!;
const data = competitorDataBlock({
  businessName: "Dalla & Bean",
  businessNameAr: null,
  handle: "rawda.coffee",
  you,
  youFollowers: 2000,
  them,
  themFollowers: 30000,
  comparison: compareAccounts(you, them),
  growth: { changePct: 4.2, weeks: 6 },
  methods: [{ method: "offer", posts: 2, avgInteractions: 820 }],
  bestCaptions: ["Weekend offer: 2 for 1 🧊"],
});

const valid = {
  tactics_en: "They post mostly Reels in the evening and seem to lean on offers.",
  tactics_ar: "ينشرون غالباً ريلز في المساء ويبدو أنهم يعتمدون على العروض.",
  they_better_en: ["Their followers grew 4.2% over 6 weeks."],
  they_better_ar: ["نما عدد متابعيهم ٤٫٢٪ خلال 6 أسابيع."],
  you_better_en: ["Your engagement per follower is higher."],
  you_better_ar: ["تفاعلكم لكل متابع أعلى."],
  ideas_en: ["Try one weekend offer as a Reel.", "Post in the evening twice this week."],
  ideas_ar: ["جربوا عرضاً واحداً في نهاية الأسبوع كريل.", "انشروا مساءً مرتين هذا الأسبوع."],
};

describe("competitor insight", () => {
  it("the data block holds both accounts' measured numbers and the comparison", () => {
    assert.match(data, /### The business \(Dalla & Bean\)/);
    assert.match(data, /### Competitor @rawda\.coffee/);
    assert.match(data, /Followers: 30000/);
    assert.match(data, /Content mix: Reels 67% \(2 posts/);
    assert.match(data, /follower change over 6 weekly snapshots: 4\.2%/);
    assert.match(data, /Engagement \(likes \+ comments per post as % of followers\): business \d/);
    assert.match(data, /estimated from captions/);
  });

  it("parses EN + AR text whose numbers all come from the data", () => {
    const insight = parseCompetitorInsight(JSON.stringify(valid), data);
    assert.equal(insight.en.ideas.length, 2);
    assert.equal(insight.ar.theyBetter[0], "نما عدد متابعيهم ٤٫٢٪ خلال 6 أسابيع.");
  });

  it("rejects an invented number, too few ideas or broken JSON", () => {
    const invent = { ...valid, tactics_en: "They gained 98765 followers last month." };
    assert.throws(() => parseCompetitorInsight(JSON.stringify(invent), data), (e: TextGenerationError) => e.reason === "bad_output");
    assert.throws(() => parseCompetitorInsight(JSON.stringify({ ...valid, ideas_en: ["One idea"] }), data), TextGenerationError);
    assert.throws(() => parseCompetitorInsight("not json", data), TextGenerationError);
  });

  it("the prompt fences the data and asks for correlation-not-causation wording in both languages", () => {
    const prompt = competitorInsightPrompt({ businessName: "Dalla & Bean", businessNameAr: null, handle: "rawda.coffee", data });
    assert.match(prompt.system, /<analysis_data>\n[\s\S]*\n<\/analysis_data>/);
    assert.match(prompt.system, /correlation, not causation/);
    assert.match(prompt.system, /respectful plural/);
    assert.match(prompt.system, /estimate/);
    assert.ok(prompt.schema);
  });
});

describe("classifying posts", () => {
  it("keeps only known ids and methods", () => {
    const result = parseClassification(JSON.stringify({ posts: [{ id: "a", method: "giveaway" }, { id: "x", method: "offer" }, { id: "b", method: "made_up" }] }), ["a", "b"]);
    assert.deepEqual([...result], [["a", "giveaway"]]);
    assert.throws(() => parseClassification(JSON.stringify({ posts: [] }), ["a"]), TextGenerationError);
  });

  it("the data block lists id, format, mentions and caption", () => {
    const block = classifyDataBlock([{ id: "a", format: "reel", caption: "With @chef.noura\n#collab", mentions: ["chef.noura"] }]);
    assert.equal(block, '- id a | reel | mentions: @chef.noura | caption: "With @chef.noura #collab"');
    assert.match(classifyPostsPrompt({ data: block }).system, /collaboration: made with another account/);
  });
});

describe("post insight", () => {
  const block = postDataBlock({
    businessName: "Dalla & Bean",
    businessNameAr: null,
    format: "reel",
    postedAt: "2026-10-12T17:00:00Z",
    caption: "Weekend special",
    method: "offer",
    promoted: true,
    vsAverage: [{ metric: "likes", value: 420, average: 210, vsAveragePct: 100, basedOn: 9 }],
    growth: { likes: 120 },
    days: 3,
  });

  it("the data block has the post's numbers, the average and the history", () => {
    assert.match(block, /Likes: 420; account average 210 over 9 posts \(\+100%\)/);
    assert.match(block, /marked as promoted/);
    assert.match(block, /last 3 daily snapshots: likes \+120/);
    assert.match(postInsightPrompt({ businessName: "Dalla & Bean", businessNameAr: null, data: block }).system, /<post_data>/);
  });

  it("accepts only numbers from the data", () => {
    const ok = { summary_en: "This Reel got 420 likes, double your average of 210.", summary_ar: "حصل هذا الريل على ٤٢٠ إعجاباً.", learn_en: "Offers as Reels seem to work for you.", learn_ar: "يبدو أن العروض كريلز تناسبكم." };
    assert.equal(parsePostInsight(JSON.stringify(ok), block).en.summary, ok.summary_en);
    assert.throws(() => parsePostInsight(JSON.stringify({ ...ok, learn_en: "Expect 5000 likes next time." }), block), TextGenerationError);
    assert.throws(() => parsePostInsight(JSON.stringify({ ...ok, learn_ar: "" }), block), TextGenerationError);
  });
});

describe("statsLines", () => {
  it("says when there are no posts", () => {
    assert.deepEqual(statsLines("X", null, null), ["### X", "No posts available."]);
  });
});
