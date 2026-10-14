import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chatTitle,
  cleanAssistantAnswer,
  formatFacts,
  postStats,
  questionLanguage,
  type AssistantFacts,
  type AssistantPost,
} from "../../lib/services/text/assistant";
import { generateGeminiText, geminiTextRequestBody } from "../../lib/services/text/gemini";
import { assistantPrompt, type AssistantPromptInput } from "../../lib/services/text/prompts";

const NOW = new Date("2026-10-14T09:00:00Z");
const metric = (value: number, changePct: number, available = true) => ({ value, changePct, available });
const post = (postedAt: string, likes: number, comments: number, extra: Partial<AssistantPost> = {}): AssistantPost => ({
  postedAt,
  type: "image",
  caption: "Fresh saffron cashews ✨",
  likes,
  comments,
  reach: 0,
  saves: 0,
  ...extra,
});

function facts(overrides: Partial<AssistantFacts> = {}): AssistantFacts {
  return {
    business: {
      name: "Mathanet Baity",
      nameAr: "مطحنة بيتي",
      type: "roastery",
      location: "Shuwaikh, Kuwait",
      description: null,
      products: ["Saffron cashews", "Arabic coffee"],
      targetAudience: null,
      languages: ["ar", "en"],
      timezone: "Asia/Kuwait",
      focus: { niche: "Specialty roastery", aim: "more_customers", goals: ["post_consistently"], timeline: "3_months" },
    },
    brand: { summary: "A family roastery.", captionStyle: "Short and warm.", postTypes: [], toneLevel: 60, wordsToUse: ["fresh roast"], wordsToAvoid: ["cheap"], hashtags: ["#mathanet_baity"] },
    instagram: { status: "connected", username: "mathanet_baity", lastSyncAt: "2026-10-14T06:00:00.000Z" },
    profile: { followers: 2000, following: 150, posts: 120 },
    metrics: { reach: metric(8400, 12.5), engagementRate: metric(4.2, -3), followerGrowth: metric(85, 20), profileVisits: metric(0, 0, false) },
    followers: { first: { date: "2026-09-14", value: 1915 }, last: { date: "2026-10-14", value: 2000 }, days: 30 },
    posts: [
      post("2026-10-12T15:00:00Z", 120, 14, { reach: 1500, type: "video" }),
      post("2026-10-09T15:00:00Z", 60, 6, { reach: 900 }),
      post("2026-10-05T15:00:00Z", 30, 2, { reach: 600 }),
      post("2026-10-01T15:00:00Z", 90, 10, { reach: 1200 }),
    ],
    windows: {
      baselineReach: 1000,
      list: [{ startHour: 18, endHour: 21, postsSampled: 4, avgReach: 1300, vsBaselinePct: 30 }],
      best: { startHour: 18, endHour: 21, liftPct: 30, sampleSize: 4, confidencePct: 70 },
    },
    ...overrides,
  };
}

describe("Assistant data", () => {
  it("derives averages, best/weakest posts and per-type numbers in code", () => {
    const stats = postStats(facts().posts!, 2000)!;
    assert.equal(stats.count, 4);
    assert.equal(stats.avgLikes, 75);
    assert.equal(stats.avgComments, 8);
    assert.equal(stats.avgReach, 1050);
    assert.equal(stats.avgEngagementPct, 4.15);
    assert.deepEqual(stats.best.map((p) => p.likes), [120, 90, 60]);
    assert.deepEqual(stats.weakest.map((p) => p.likes), [30, 60, 90]);
    assert.deepEqual(stats.byType, [
      { type: "image", posts: 3, avgInteractions: 66 },
      { type: "video", posts: 1, avgInteractions: 134 },
    ]);
    assert.equal(postStats([], 100), null);
    assert.equal(postStats([post("2026-10-01T00:00:00Z", 5, 1)], null)!.avgEngagementPct, null);
  });

  it("analytics: metrics, followers, posts and posting times — and unavailable metrics say so", () => {
    const text = formatFacts(facts(), "analytics", NOW);
    assert.match(text, /Accounts reached: 8400 \(\+12\.5% vs the previous 30 days\)/);
    assert.match(text, /Engagement rate: 4\.2% \(-3% vs the previous 30 days\)/);
    assert.match(text, /Profile visits: not available from Instagram yet/);
    assert.match(text, /Followers: 1915 on 2026-09-14 → 2000 on 2026-10-14/);
    assert.match(text, /Averages per post: 75 likes, 8 comments, reach 1050, engagement 4\.15% of followers/);
    assert.match(text, /18:00–21:00: 4 posts, average reach 1300 \(\+30% vs baseline\)/);
    assert.match(text, /based on 4 posts, 70% confidence/);
    assert.doesNotMatch(text, /Tracked competitors/);
  });

  it("not connected: no Instagram numbers at all, and the block says there is no data", () => {
    const text = formatFacts(facts({ instagram: { status: "not_connected", username: null, lastSyncAt: null }, profile: undefined, metrics: undefined, followers: undefined, posts: undefined, windows: undefined }), "analytics", NOW);
    assert.match(text, /not connected, so there is NO Instagram performance data/);
    assert.doesNotMatch(text, /Accounts reached|Recent posts|Posting times|followers/);
  });

  it("demo and stale data are labelled as such", () => {
    assert.match(formatFacts(facts({ instagram: { status: "demo", username: "mathanet_baity", lastSyncAt: null } }), "analytics", NOW), /the app's sample data/);
    assert.match(formatFacts(facts({ instagram: { status: "reconnect_needed", username: "x", lastSyncAt: "2026-10-01T00:00:00.000Z" } }), "analytics", NOW), /last successful sync and may be out of date \(last synced 2026-10-01/);
  });

  it("competitors: only stored competitor numbers, an honest note when there are none", () => {
    const none = formatFacts(facts({ competitors: [] }), "competitors", NOW);
    assert.match(none, /Tracked competitors \(0\)\nNone\./);
    assert.match(none, /We store no captions, prices, ads, audience or reach data for competitors\./);
    const some = formatFacts(
      facts({
        competitors: [
          { handle: "rival", name: "Rival Roastery", followers: 5400, engagementRate: 2.1, followerChangePct: null, postsPerWeek: 4, recentPosts: [{ likes: 100, comments: 5 }, { likes: 50, comments: 3 }], lastFetchedAt: "2026-10-13T10:00:00.000Z", note: null },
        ],
      }),
      "competitors",
      NOW,
    );
    assert.match(some, /@rival \(Rival Roastery\): 5400 followers, engagement 2\.1%, 4 posts\/week, 2 recent posts averaging 75 likes and 4 comments; data from 2026-10-13/);
    // No follower history → no made-up change figure.
    assert.doesNotMatch(some, /in ~30 days/);
    // The competitor block doesn't include posting-time analysis of the business.
    assert.doesNotMatch(some, /Posting times/);
  });

  it("post mode: brand profile, hashtags and recent posts, without the account metrics", () => {
    const text = formatFacts(facts(), "post", NOW);
    assert.match(text, /Brand hashtags \(the only ones a caption may use\): #mathanet_baity/);
    assert.match(text, /Words to use: fresh roast; words to avoid: cheap/);
    assert.match(text, /Recent posts \(4, newest first\)/);
    assert.doesNotMatch(text, /Account metrics/);
  });

  it("language follows the question; titles are one short line", () => {
    assert.equal(questionLanguage("كيف أداء حسابي؟"), "ar");
    assert.equal(questionLanguage("How am I doing? 📈"), "en");
    assert.equal(chatTitle("  What should\nI post   next?  "), "What should I post next?");
    const long = chatTitle("a".repeat(100));
    assert.equal(long.length, 58);
    assert.ok(long.endsWith("…"));
  });

  it("answers come back as plain text", () => {
    assert.equal(cleanAssistantAnswer("## Summary\n**Reach** is up.\n* first\n• second\n\n\n\nDone"), "Summary\nReach is up.\n- first\n- second\n\nDone");
  });
});

function promptInput(overrides: Partial<AssistantPromptInput> = {}): AssistantPromptInput {
  return {
    mode: "analytics",
    language: "en",
    businessName: "Mathanet Baity",
    businessNameAr: "مطحنة بيتي",
    facts: formatFacts(facts(), "analytics", NOW),
    history: [],
    question: "How is my account doing?",
    ...overrides,
  };
}

describe("Assistant prompt", () => {
  it("grounds every answer in the business data and forbids invented numbers", () => {
    const p = assistantPrompt(promptInput());
    assert.match(p.system, /Mode: ANALYTICS/);
    assert.match(p.system, /Never invent numbers/);
    assert.match(p.system, /correlation, not causation/);
    assert.match(p.system, /If Instagram is not connected, there is no performance data/);
    assert.match(p.system, /<business_data>\n[\s\S]*Accounts reached: 8400[\s\S]*\n<\/business_data>/);
    assert.match(p.system, /Reply in English/);
    assert.equal(p.user, "How is my account doing?");
    assert.equal(p.schema, undefined);
  });

  it("each mode asks for its own kind of answer", () => {
    assert.match(assistantPrompt(promptInput({ mode: "post" })).system, /Mode: POST[\s\S]*hashtags only from the brand hashtag list/);
    assert.match(assistantPrompt(promptInput({ mode: "competitors" })).system, /Mode: COMPETITORS[\s\S]*say so honestly/);
  });

  it("Arabic: respectful plural, no gender, the Arabic business name", () => {
    const p = assistantPrompt(promptInput({ language: "ar", question: "كيف أداء حسابي؟" }));
    assert.match(p.system, /Reply in Arabic \(Arabic script\)/);
    assert.match(p.system, /respectful plural/);
    assert.match(p.system, /never assume their gender/);
    assert.match(p.system, /"مطحنة بيتي"/);
  });

  it("sends earlier messages as chat turns before the new question", async () => {
    const p = assistantPrompt(
      promptInput({
        history: [
          { role: "user", text: "Which post did best?" },
          { role: "assistant", text: "Your 12 October reel: 120 likes and 14 comments." },
        ],
        question: "Why?",
      }),
    );
    const body = geminiTextRequestBody(p);
    assert.deepEqual(
      body.contents.map((c) => [c.role, c.parts[0].text]),
      [
        ["user", "Which post did best?"],
        ["model", "Your 12 October reel: 120 likes and 14 comments."],
        ["user", "Why?"],
      ],
    );
    assert.equal(body.generationConfig.responseMimeType, "text/plain");

    let sent: unknown = null;
    const fetchImpl = (async (_url: string | URL, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "It was a video, and videos got more interactions in your data." }] } }] }), { status: 200 });
    }) as typeof fetch;
    const text = await generateGeminiText({ apiKey: "AQ.TEST-not-a-real-key-0123456789abcdef", model: "gemini-3.5-flash-lite", rpm: 12, rpd: 450, baseUrl: "https://gemini.test/v1beta" }, p, fetchImpl);
    assert.match(text, /videos got more interactions/);
    assert.equal((sent as { contents: unknown[] }).contents.length, 3);
  });
});
