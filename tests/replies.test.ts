import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COMMENT_REPLY_MAX,
  DM_REPLY_MAX,
  asIsRate,
  hoursLeft,
  nameCandidates,
  pickEditExamples,
  replyOutcome,
  replyProblem,
  scrubReply,
  wordOverlap,
} from "../lib/replies";
import { TextRequestGate } from "../lib/services/text/gate";
import { replyPrompt, type ReplyPromptInput } from "../lib/services/text/prompts";

describe("replyProblem: Instagram's limits", () => {
  it("accepts a normal reply on both channels", () => {
    assert.equal(replyProblem("Thank you! 🤍", "comment"), null);
    assert.equal(replyProblem("Thank you! 🤍", "dm"), null);
  });

  it("refuses an empty reply unless only the keyword DM is sent", () => {
    assert.equal(replyProblem("   ", "comment"), "empty");
    assert.equal(replyProblem("", "comment", { allowEmpty: true }), null);
  });

  it("limits comment replies to 300 characters and DMs to 1,000", () => {
    assert.equal(replyProblem("a".repeat(COMMENT_REPLY_MAX), "comment"), null);
    assert.equal(replyProblem("a".repeat(COMMENT_REPLY_MAX + 1), "comment"), "too_long");
    assert.equal(replyProblem("a".repeat(COMMENT_REPLY_MAX + 1), "dm"), null);
    assert.equal(replyProblem("a".repeat(DM_REPLY_MAX + 1), "dm"), "too_long");
  });

  it("counts the trimmed text", () => {
    assert.equal(replyProblem(`  ${"a".repeat(COMMENT_REPLY_MAX)}  `, "comment"), null);
  });

  it("limits hashtags and links in comment replies only", () => {
    assert.equal(replyProblem("#a #b #c #d", "comment"), null);
    assert.equal(replyProblem("#a #b #c #d #e", "comment"), "too_many_hashtags");
    assert.equal(replyProblem("#a #b #c #d #e", "dm"), null);
    assert.equal(replyProblem("see https://a.example and www.b.example", "comment"), "too_many_links");
    assert.equal(replyProblem("see https://a.example", "comment"), null);
  });
});

describe("replyOutcome: sent as-is, edited or written by hand", () => {
  const draft = "Thank you Sara! 🤍 Send us a DM if there's anything we can help with.";

  it("is as-is when only spacing or case changed", () => {
    assert.equal(replyOutcome(draft, draft), "as_is");
    assert.equal(replyOutcome(draft, `  ${draft.replace("Thank", "thank")}  `), "as_is");
  });

  it("is edited when most words were kept", () => {
    assert.equal(replyOutcome(draft, "Thank you Sara! 🤍 DM us if there's anything we can help with."), "edited");
  });

  it("is written by hand when little of the draft is left, or there was no draft", () => {
    assert.equal(replyOutcome(draft, "Our new beans arrive Thursday, come early!"), "manual");
    assert.equal(replyOutcome("", "Hello there"), "manual");
    assert.equal(replyOutcome(null, "Hello there"), "manual");
  });

  it("works for Arabic", () => {
    const ar = "شكراً سارة 🤍 نورتونا! أي سؤال إحنا موجودين بالخاص.";
    assert.equal(replyOutcome(ar, ar), "as_is");
    assert.equal(replyOutcome(ar, "شكراً سارة 🤍 نورتونا! أي استفسار حياكم بالخاص."), "edited");
  });

  it("wordOverlap is symmetric and bounded", () => {
    assert.equal(wordOverlap("a b c", "a b c"), 1);
    assert.equal(wordOverlap("a b", "c d"), 0);
    assert.equal(wordOverlap("a b c d", "a b"), wordOverlap("a b", "a b c d"));
  });

  it("asIsRate rounds the share sent as-is", () => {
    assert.equal(asIsRate({ as_is: 2, edited: 1, manual: 0 }), 67);
    assert.equal(asIsRate({ as_is: 0, edited: 0, manual: 0 }), null);
  });
});

describe("learning from edits without customer data", () => {
  it("replaces the customer's name, handle pieces, mentions, emails and phone numbers", () => {
    const text = "Hi Sara! Thanks @sara.k_92 — write to hello@shop.kw or call +965 9999 1234. @noura_kw too.";
    const out = scrubReply(text, ["sara.k_92"]);
    assert.ok(!/sara/i.test(out), out);
    assert.ok(!out.includes("hello@shop.kw"), out);
    assert.ok(!out.includes("9999"), out);
    assert.ok(!out.includes("noura"), out);
    assert.match(out, /^Hi \{name\}! Thanks \{name\} — write to \{email\} or call \{phone\}\. \{name\} too\.$/);
  });

  it("scrubs Arabic text and keeps the business's own words", () => {
    const out = scrubReply("هلا نورة 🤍 حياكم في دلة وبن", ["نورة"]);
    assert.equal(out, "هلا {name} 🤍 حياكم في دلة وبن");
  });

  it("finds names the business typed when the customer's handle is unknown", () => {
    assert.deepEqual(nameCandidates("Hi Sara! Yes, we have oat milk ☕", ""), ["Sara"]);
    assert.deepEqual(nameCandidates("Thanks for asking!", "Hi, I'm Noura. Do you deliver to Jahra?"), ["Noura", "Jahra"]);
    assert.deepEqual(nameCandidates("هلا نورة 🤍 حياكم", "مرحبا معكم نورة"), ["نورة"]);
    // An Arabic word after a greeting that the customer never wrote is not a name ("شكراً على…").
    assert.deepEqual(nameCandidates("شكراً على رسالتكم", "عندكم توصيل؟"), []);
    const [example] = pickEditExamples([
      { aiReply: "Thanks for your message! 🤍", draftReply: "Hi Sara! Yes, we have oat milk every day ☕", commenterUsername: "", commentText: "Hi, I'm Sara. Do you have oat milk?" },
    ]);
    assert.deepEqual(example, { draft: "Thanks for your message! 🤍", sent: "Hi {name}! Yes, we have oat milk every day ☕" });
  });

  it("picks only changed drafts, newest first, at most three, without duplicates", () => {
    const rows = [
      { aiReply: "Thank you Sara! 🤍", draftReply: "Thanks a lot Sara, see you soon ☕", commenterUsername: "sara" },
      { aiReply: "Thank you Ali!", draftReply: "Thank you Ali!", commenterUsername: "ali" },
      { aiReply: "Hi Mona!", draftReply: "Thanks a lot Mona, see you soon ☕", commenterUsername: "mona" },
      { aiReply: "Hello Dana", draftReply: "Welcome Dana, the oud blend is back", commenterUsername: "dana" },
      { aiReply: "Hey Reem", draftReply: "Reem, thank you for visiting!", commenterUsername: "reem" },
      { aiReply: "Hey Lulu", draftReply: "Lulu, so glad you liked it", commenterUsername: "lulu" },
    ];
    const examples = pickEditExamples(rows);
    assert.equal(examples.length, 3);
    assert.deepEqual(examples[0], { draft: "Thank you {name}! 🤍", sent: "Thanks a lot {name}, see you soon ☕" });
    // Ali's was sent as-is; Mona's is the same text as Sara's once anonymised.
    assert.deepEqual(
      examples.map((e) => e.sent),
      ["Thanks a lot {name}, see you soon ☕", "Welcome {name}, the oud blend is back", "{name}, thank you for visiting!"],
    );
    for (const e of examples) assert.ok(!/sara|mona|dana|reem/i.test(e.draft + e.sent));
  });
});

describe("DM window", () => {
  const now = Date.parse("2026-10-15T12:00:00Z");
  it("rounds up to whole hours and is 0 once closed", () => {
    assert.equal(hoursLeft("2026-10-15T14:30:00Z", now), 3);
    assert.equal(hoursLeft("2026-10-15T12:10:00Z", now), 1);
    assert.equal(hoursLeft("2026-10-15T11:00:00Z", now), 0);
  });
});

describe("TextRequestGate.peek (Regenerate shown as unavailable up front)", () => {
  it("doesn't take a slot", () => {
    let t = 1_000_000;
    const gate = new TextRequestGate(1, 10, () => t);
    assert.deepEqual(gate.peek(), { allowed: true });
    assert.deepEqual(gate.peek(), { allowed: true });
    assert.equal(gate.acquire().allowed, true);
    const blocked = gate.peek();
    assert.equal(blocked.allowed, false);
    assert.equal(!blocked.allowed && blocked.reason, "rate_limited");
    t += 61_000;
    assert.deepEqual(gate.peek(), { allowed: true });
  });

  it("reports a pause after a failure and the daily budget", () => {
    let t = 1_000_000;
    const gate = new TextRequestGate(100, 1, () => t);
    gate.acquire();
    const daily = gate.peek();
    assert.equal(!daily.allowed && daily.reason, "daily_limit");
    const paused = new TextRequestGate(100, 100, () => t);
    paused.failed("invalid_key");
    const p = paused.peek();
    assert.equal(!p.allowed && p.reason, "invalid_key");
    t += 31 * 60_000;
    assert.deepEqual(paused.peek(), { allowed: true });
  });
});

describe("replyPrompt with edits and Regenerate", () => {
  const base: ReplyPromptInput = { businessName: "Dalla & Bean", businessNameAr: null, text: "Love this place!", greetName: "Sara", language: "en", channel: "comment", toneLevel: 50, brandWords: [] };

  it("fences the edited examples as data and asks to match them", () => {
    const prompt = replyPrompt({ ...base, examples: [{ draft: "Thank you {name}!", sent: "Thanks {name}, see you soon ☕" }] });
    assert.match(prompt.user, /<edited_drafts>\n1\. AI draft: Thank you \{name\}!\n {3}Sent instead: Thanks \{name\}, see you soon ☕\n<\/edited_drafts>/);
    assert.match(prompt.user, /Match how they write/);
  });

  it("leaves the examples out when there are none", () => {
    assert.ok(!replyPrompt(base).user.includes("edited_drafts"));
  });

  it("asks for a different, shorter version with the previous draft fenced", () => {
    const prompt = replyPrompt({ ...base, previous: "Thank you Sara! 🤍", tone: "shorter" });
    assert.match(prompt.user, /clearly different from the previous draft/);
    assert.match(prompt.user, /noticeably shorter/);
    assert.match(prompt.user, /<previous_draft>\nThank you Sara! 🤍\n<\/previous_draft>/);
  });

  it("states the channel's character limit", () => {
    assert.match(replyPrompt(base).user, /under 300 characters/);
    assert.match(replyPrompt({ ...base, channel: "dm" }).user, /under 1000 characters/);
  });
});
