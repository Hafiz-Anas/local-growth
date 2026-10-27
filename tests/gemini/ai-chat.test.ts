import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AI_CHAT_MAX_QUESTION, cleanChatAnswer, questionLanguage } from "../../lib/services/text/ai-chat";
import { aiChatPrompt } from "../../lib/services/text/prompts";

describe("AI tab: typed questions", () => {
  const input = { mode: "post" as const, language: "en" as const, businessName: "Mathanet Baity", businessNameAr: "مذاقات بيتي", question: "What works on Instagram?" };

  it("asks for a short general reply with no numbers, in the question's language", () => {
    const prompt = aiChatPrompt(input);
    assert.match(prompt.system, /Mathanet Baity/);
    assert.match(prompt.system, /Never give numbers/);
    assert.match(prompt.system, /under 80 words/);
    assert.match(prompt.system, /Reply in English/);
    assert.match(aiChatPrompt({ ...input, language: "ar" }).system, /Reply in Arabic/);
    assert.equal(prompt.user, input.question);
    assert.equal(aiChatPrompt({ ...input, question: "x".repeat(900) }).user.length, AI_CHAT_MAX_QUESTION);
  });

  it("follows the question's language and returns plain text", () => {
    assert.equal(questionLanguage("متى أنشر؟"), "ar");
    assert.equal(questionLanguage("When should I post?"), "en");
    assert.equal(cleanChatAnswer("## Tip\n**Post** daily\n* at 8 PM\n\n\n\nThanks"), "Tip\nPost daily\n- at 8 PM\n\nThanks");
  });
});
