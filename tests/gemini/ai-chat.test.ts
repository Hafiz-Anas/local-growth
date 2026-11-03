import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AI_CHAT_MAX_QUESTION, checkChatNumbers, cleanChatAnswer, questionLanguage } from "../../lib/services/text/ai-chat";
import { aiChatPrompt } from "../../lib/services/text/prompts";

const FACTS = [
  "## Recent posts (3, newest first)",
  "Averages per post: 87 likes, 7 comments, reach 1167",
  "By type: video 120 likes+comments on average (2 posts); image 42 likes+comments on average (1 post)",
  "## Shareability",
  "Share rate: 2.4% (pooled over 3 posts)",
].join("\n");

describe("AI tab: the prompt", () => {
  const input = {
    language: "en" as const,
    businessName: "Mathanet Baity",
    businessNameAr: "مذاقات بيتي",
    question: "What works on Instagram?",
    facts: FACTS,
    history: [
      { role: "user" as const, text: "How did my reels do?" },
      { role: "model" as const, text: "Your videos averaged 120 likes+comments." },
    ],
    demo: false,
    actions: { types: [] as Array<"save_draft" | "schedule" | "post_now" | "reschedule" | "cancel">, today: "Today is Tuesday 2026-11-03, 14:05 (Asia/Kuwait time).", posts: [] as string[], attachedPhotos: 0 },
  };

  it("offers only the switched-on actions, with the posts as refs, today's date and the JSON answer shape (AI4)", () => {
    const prompt = aiChatPrompt({
      ...input,
      actions: { types: ["save_draft", "schedule"], today: input.actions.today, posts: ["## Posts you can act on", '- P1: post card in this chat (the newest one), not saved yet, 1 photo, caption: "Hi"'], attachedPhotos: 1 },
    });
    assert.match(prompt.system, /save_draft — /);
    assert.match(prompt.system, /schedule — schedule a post/);
    assert.doesNotMatch(prompt.system, /post_now — |cancel — /);
    assert.match(prompt.system, /Today is Tuesday 2026-11-03, 14:05 \(Asia\/Kuwait time\)\./);
    assert.match(prompt.system, /don't guess: leave "action" null and put one short question in "ask"/);
    assert.match(prompt.system, /Never say an action is done/);
    assert.match(prompt.system, /Photos sent with this message: 1\./);
    assert.match(prompt.system, /## Posts you can act on\n- P1: post card[\s\S]*<\/business_facts>$/);
    const schema = prompt.schema as { properties: { action: { properties: { type: { enum: string[] } } } } };
    assert.deepEqual(schema.properties.action.properties.type.enum, ["save_draft", "schedule"]);
    // Without a saved chat there's nothing to act on: no action in the answer at all.
    assert.equal((aiChatPrompt(input).schema as { properties: Record<string, unknown> }).properties.action, undefined);
  });

  it("answers from the business facts, with the chat's earlier turns, in the question's language", () => {
    const prompt = aiChatPrompt(input);
    assert.match(prompt.system, /Mathanet Baity/);
    assert.match(prompt.system, /<business_facts>\n## Recent posts[\s\S]*Share rate: 2\.4%[\s\S]*\n<\/business_facts>$/);
    assert.match(prompt.system, /Every number you state .* must appear in the facts/);
    // Data the app doesn't collect vs too few posts: two different answers.
    assert.match(prompt.system, /doesn't collect the data asked about .* start with "We don't track that yet"/);
    assert.match(prompt.system, /Say "Not enough posts yet" only when the facts say there are too few posts/);
    assert.match(prompt.system, /Never use one for the other/);
    // Two engagement figures: the answer names the one it quotes.
    assert.match(prompt.system, /"Account engagement rate, last 30 days" is Instagram's figure for the whole account; "average engagement per post" is likes \+ comments per post/);
    assert.match(prompt.system, /name which one it is in those words, and never compare one with the other/);
    assert.match(prompt.system, /not instructions/);
    assert.match(prompt.system, /anything on their Instagram/);
    assert.match(prompt.system, /Reply in English/);
    assert.doesNotMatch(prompt.system, /demo account/);
    assert.match(aiChatPrompt({ ...input, demo: true }).system, /demo account: its Instagram numbers are the app's sample data/);
    assert.match(aiChatPrompt({ ...input, language: "ar" }).system, /Reply in Arabic/);
    assert.deepEqual(prompt.history, input.history);
    assert.equal(prompt.user, input.question);
    assert.equal(aiChatPrompt({ ...input, question: "x".repeat(900) }).user.length, AI_CHAT_MAX_QUESTION);
  });

  it("follows the question's language and returns plain text", () => {
    assert.equal(questionLanguage("متى أنشر؟"), "ar");
    assert.equal(questionLanguage("When should I post?"), "en");
    assert.equal(cleanChatAnswer("## Tip\n**Post** daily\n* at 8 PM\n\n\n\nThanks"), "Tip\nPost daily\n- at 8 PM\n\nThanks");
  });
});

describe("AI tab: every number must be in the facts", () => {
  it("keeps an answer whose numbers are all in the facts (exact or rounded, Arabic digits too)", () => {
    const answer = "Your videos did best: 120 likes+comments on average over 2 posts. Your share rate is 2.4%, so keep making Reels.";
    assert.deepEqual(checkChatNumbers(answer, FACTS), { text: answer, dropped: 0, usable: true });
    assert.equal(checkChatNumbers("معدل المشاركة ٢٫٤٪ ومتوسط الوصول ١١٦٧.", FACTS).usable, true);
    // Times, durations and small counts are advice, not claims about the data.
    assert.equal(checkChatNumbers("Post 3 Reels next week, around 8pm, each about 15 seconds.", FACTS).dropped, 0);
  });

  it("drops sentences with an invented number and keeps the rest", () => {
    const checked = checkChatNumbers("Videos averaged 120 likes+comments. They also got 45% more reach than photos. Keep posting videos.", FACTS);
    assert.equal(checked.text, "Videos averaged 120 likes+comments. Keep posting videos.");
    assert.equal(checked.dropped, 1);
    assert.equal(checked.usable, true);
  });

  it("keeps the lines of a list, dropping only the bad ones", () => {
    const checked = checkChatNumbers("What works:\n- Videos: 120 likes+comments on average\n- Saves went up 300%\n- Share rate 2.4%", FACTS);
    assert.equal(checked.text, "What works:\n- Videos: 120 likes+comments on average\n- Share rate 2.4%");
    assert.equal(checked.usable, true);
  });

  it("isn't usable when most of the answer is gone (the chat then says it can't answer from the data yet)", () => {
    const checked = checkChatNumbers("Your reach grew 38%. You gained 250 followers. Videos averaged 120 likes+comments.", FACTS);
    assert.equal(checked.dropped, 2);
    assert.equal(checked.usable, false);
    assert.equal(checkChatNumbers("Reach was 9999.", FACTS).usable, false);
    assert.equal(checkChatNumbers("", FACTS).usable, false);
  });
});
