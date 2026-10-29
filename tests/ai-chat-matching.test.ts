import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chatFallback, localAnswerFor, matchQuestion, matchRule } from "../mock-data/gallery/ai-chat";

// Chats have no mode: one set of keyword rules covers every topic (components/ai-chat/engine.ts).
describe("AI chat: typed questions without modes", () => {
  it("routes each topic to its answer, whatever was asked before", () => {
    assert.equal(matchRule("What should I post tomorrow?"), "post-next");
    assert.equal(matchRule("Which post did best?"), "an-best");
    assert.equal(matchRule("When is the best time to post?"), "an-when");
    assert.equal(matchRule("How is my reach?"), "an-reach");
    assert.equal(matchRule("Which post got shared the most?"), "an-shared");
    assert.equal(matchRule("How do I compare with my competitors?"), "co-compare");
    assert.equal(matchRule("Suggest hashtags"), "post-hashtags");
    assert.equal(matchRule("Write me a caption"), "post-caption");
  });

  it("works in Arabic", () => {
    assert.equal(matchRule("متى أنشر؟"), "an-when");
    assert.equal(matchRule("كيف أقارن مع المنافسين؟"), "co-compare");
    assert.equal(matchRule("اقترح هاشتاقات"), "post-hashtags");
  });

  it("anything else gets the note to try a suggested question, not a mode's sample answer", () => {
    assert.equal(matchRule("Tell me a joke"), null);
    assert.equal(matchQuestion("Tell me a joke"), "fallback");
  });
});

// Real businesses never get the proposal's sample answers (components/ai-chat/engine.ts: send / askAi).
describe("AI chat: sample answers are for demo businesses only", () => {
  it("a demo business gets the sample answer at once; a real business asks the AI", () => {
    assert.equal(localAnswerFor("How is my reach?", true), "an-reach");
    assert.equal(localAnswerFor("How is my reach?", false), null);
    assert.equal(localAnswerFor("كيف أقارن مع المنافسين؟", false), null);
    assert.equal(localAnswerFor("Write me a caption", false), null);
    // Asking for a post starts the post flow either way (a real business's own photos).
    assert.equal(localAnswerFor("What should I post tomorrow?", false), "post-next");
  });

  it("when the AI can't answer, a real business gets an honest note, never a sample", () => {
    for (const q of ["How is my reach?", "Which post got shared the most?", "When should I post?", "Tell me a joke", "متى أنشر؟"]) {
      assert.deepEqual(chatFallback(q, false), { kind: "honest" }, q);
    }
    assert.deepEqual(chatFallback("What should I post tomorrow?", false), { kind: "post" });
  });

  it("a demo business keeps the sample answer (or the note to try a suggested question)", () => {
    assert.deepEqual(chatFallback("How is my reach?", true), { kind: "sample", answerId: "an-reach" });
    assert.deepEqual(chatFallback("Tell me a joke", true), { kind: "sample", answerId: "fallback" });
    assert.deepEqual(chatFallback("What should I post tomorrow?", true), { kind: "post" });
  });
});
