import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KEYWORD_COOLDOWN_MS, decideKeywordReply, matchesKeyword, normalizeText, rankMatches, type CommentLike, type KeywordRuleLike, type RecentTrigger } from "../lib/keyword-replies";

const T0 = new Date("2026-10-01T00:00:00Z");
const NOW = new Date("2026-10-13T12:00:00Z");

let n = 0;
function rule(over: Partial<KeywordRuleLike> = {}): KeywordRuleLike {
  n += 1;
  return { id: `r${n}`, keywords: ["menu"], matchType: "word", active: true, scope: "all", mediaIds: [], createdAt: T0, ...over };
}

function comment(text: string, over: Partial<CommentLike> = {}): CommentLike {
  return { igCommentId: "c1", igMediaId: "m1", text, commenterKey: "noura.kw", postedAt: NOW, ...over };
}

const own = { igUserId: "1784100", username: "dallabean.cafe" };

function decide(text: string, rules: KeywordRuleLike[], extra: Partial<Parameters<typeof decideKeywordReply>[0]> = {}) {
  return decideKeywordReply({ comment: comment(text), rules, ownAccount: own, alreadyHandled: false, recent: [], now: NOW, ...extra });
}

describe("normalizeText", () => {
  it("lower-cases and drops punctuation and emojis", () => {
    assert.equal(normalizeText("  MENU!!! 😍🔥 "), "menu");
    assert.equal(normalizeText("Menu, please?"), "menu please");
    assert.equal(normalizeText("👍🏽❤️‍🔥"), "");
  });

  it("folds Arabic letter variants, diacritics and tatweel", () => {
    assert.equal(normalizeText("أسعار"), "اسعار");
    assert.equal(normalizeText("إمارات آمنة ٱلخير"), "امارات امنه الخير");
    assert.equal(normalizeText("مستشفى"), "مستشفي");
    assert.equal(normalizeText("قائمةُ الطَّعامِ"), "قائمه الطعام");
    assert.equal(normalizeText("منـــيو"), "منيو");
    assert.equal(normalizeText("٣ قطع"), "3 قطع");
  });

  it("removes Arabic punctuation", () => {
    assert.equal(normalizeText("منيو؟!،"), "منيو");
  });
});

describe("matchesKeyword — whole word", () => {
  it("is case-insensitive and ignores punctuation and emojis", () => {
    assert.equal(matchesKeyword("Can I see the MENU? 😍", "menu", "word"), true);
    assert.equal(matchesKeyword("menu!!!", "MENU", "word"), true);
    assert.equal(matchesKeyword("🔥menu🔥", "menu", "word"), true);
  });

  it("doesn't match inside another word", () => {
    assert.equal(matchesKeyword("menus please", "menu", "word"), false);
    assert.equal(matchesKeyword("the pricey one", "price", "word"), false);
    assert.equal(matchesKeyword("menuitem", "menu", "word"), false);
  });

  it("matches multi-word keywords as a run of words", () => {
    assert.equal(matchesKeyword("what's the delivery price?", "delivery price", "word"), true);
    assert.equal(matchesKeyword("price of delivery", "delivery price", "word"), false);
  });

  it("matches Arabic across spelling variants and diacritics", () => {
    assert.equal(matchesKeyword("ممكن المنيو؟", "منيو", "word"), true, "with the article");
    assert.equal(matchesKeyword("ابي منيو لو سمحت", "منيو", "word"), true);
    assert.equal(matchesKeyword("كم الأسعار", "اسعار", "word"), true, "أ → ا");
    assert.equal(matchesKeyword("كم الاسعار", "أسعار", "word"), true, "keyword with hamza");
    assert.equal(matchesKeyword("ابي القائمة", "قائمه", "word"), true, "ة → ه");
    assert.equal(matchesKeyword("وين المستشفى", "مستشفي", "word"), true, "ى → ي");
    assert.equal(matchesKeyword("بِكَمْ هذا", "بكم", "word"), true, "diacritics");
  });

  it("doesn't match an Arabic keyword inside a longer word", () => {
    assert.equal(matchesKeyword("منيوهات", "منيو", "word"), false);
  });

  it("never matches an empty or punctuation-only keyword", () => {
    assert.equal(matchesKeyword("anything", "", "word"), false);
    assert.equal(matchesKeyword("!!!", "!!!", "word"), false);
  });
});

describe("matchesKeyword — exact comment", () => {
  it("matches only when the whole comment is the keyword", () => {
    assert.equal(matchesKeyword("MENU", "menu", "exact"), true);
    assert.equal(matchesKeyword("  Menu!! 😍 ", "menu", "exact"), true);
    assert.equal(matchesKeyword("menu please", "menu", "exact"), false);
    assert.equal(matchesKeyword("منيو 🙏", "منيو", "exact"), true);
    assert.equal(matchesKeyword("المنيو", "منيو", "exact"), true);
    assert.equal(matchesKeyword("ابي المنيو", "منيو", "exact"), false);
  });
});

describe("rankMatches", () => {
  it("skips paused rules, rules for other posts and rules newer than the comment", () => {
    const paused = rule({ active: false });
    const otherPost = rule({ scope: "selected", mediaIds: ["m2"] });
    const thisPost = rule({ scope: "selected", mediaIds: ["m1", "m2"] });
    const newer = rule({ createdAt: new Date(NOW.getTime() + 1000) });
    assert.deepEqual(rankMatches([paused, otherPost, thisPost, newer], comment("menu")).map((m) => m.rule.id), [thisPost.id]);
    assert.deepEqual(rankMatches([thisPost], comment("menu", { igMediaId: null })), []);
  });

  it("puts exact rules first, then longer keywords, then older rules", () => {
    const older = rule({ keywords: ["price"], createdAt: new Date("2026-09-01T00:00:00Z") });
    const newer = rule({ keywords: ["price"], createdAt: new Date("2026-09-15T00:00:00Z") });
    const longer = rule({ keywords: ["delivery price"] });
    const exact = rule({ keywords: ["price"], matchType: "exact" });
    assert.deepEqual(rankMatches([newer, older, longer], comment("delivery price?")).map((m) => m.rule.id), [longer.id, older.id, newer.id]);
    assert.deepEqual(rankMatches([newer, exact, older], comment("PRICE")).map((m) => m.rule.id), [exact.id, older.id, newer.id]);
  });

  it("reports the longest keyword of the rule that matched", () => {
    const r = rule({ keywords: ["price", "delivery price"] });
    assert.equal(rankMatches([r], comment("delivery price"))[0].keyword, "delivery price");
  });
});

describe("decideKeywordReply", () => {
  it("returns none when no rule matches (the comment goes to the AI draft queue)", () => {
    assert.deepEqual(decide("lovely photo", [rule()]), { action: "none" });
  });

  it("never replies to the business's own comments", () => {
    const r = rule();
    assert.deepEqual(decideKeywordReply({ comment: comment("menu", { commenterKey: "dallabean.cafe" }), rules: [r], ownAccount: own, alreadyHandled: false, recent: [] }), { action: "skip", reason: "own_comment" });
    assert.deepEqual(decide("menu", [r], { commenterId: own.igUserId }), { action: "skip", reason: "own_comment" });
  });

  it("dedupes: a comment that was already handled is skipped", () => {
    assert.deepEqual(decide("menu", [rule()], { alreadyHandled: true }), { action: "skip", reason: "already_handled" });
  });

  it("replies with the best matching rule", () => {
    const a = rule({ keywords: ["menu"] });
    const b = rule({ keywords: ["menu"], matchType: "exact" });
    const decision = decide("Menu!", [a, b]);
    assert.equal(decision.action, "reply");
    assert.equal(decision.action === "reply" && decision.rule.id, b.id);
  });

  it("holds back the same person + same rule within 24 hours", () => {
    const r = rule();
    const recent: RecentTrigger[] = [{ ruleId: r.id, commenterKey: "noura.kw", at: new Date(NOW.getTime() - 60_000) }];
    const decision = decide("menu", [r], { recent });
    assert.equal(decision.action, "cooldown");
  });

  it("lets the same person trigger again after 24 hours, and other people at any time", () => {
    const r = rule();
    const old: RecentTrigger[] = [{ ruleId: r.id, commenterKey: "noura.kw", at: new Date(NOW.getTime() - KEYWORD_COOLDOWN_MS - 1) }];
    assert.equal(decide("menu", [r], { recent: old }).action, "reply");
    const someoneElse: RecentTrigger[] = [{ ruleId: r.id, commenterKey: "fahad", at: NOW }];
    assert.equal(decide("menu", [r], { recent: someoneElse }).action, "reply");
  });

  it("falls through to the next matching rule when the best one is cooling down", () => {
    const best = rule({ keywords: ["menu"], matchType: "exact" });
    const next = rule({ keywords: ["menu"] });
    const recent: RecentTrigger[] = [{ ruleId: best.id, commenterKey: "noura.kw", at: NOW }];
    const decision = decide("menu", [best, next], { recent });
    assert.equal(decision.action === "reply" && decision.rule.id, next.id);
  });
});
