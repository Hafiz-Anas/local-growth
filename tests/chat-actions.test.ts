import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { asksForAction, isExpired, needsApproval } from "../lib/gallery/chat-actions";
import {
  chatAnswerSchema,
  decideAction,
  localStamp,
  mentionsClockTime,
  parseChatAnswer,
  postRefLines,
  resolveLocalTime,
  todayLine,
  wantsCaptionChange,
  type ChatPostRef,
  type RawChatAction,
} from "../lib/services/text/chat-actions";

describe("AI actions: checks that don't trust the model (from the real Gemini run, 2026-11-03)", () => {
  it("needs a clock time in the owner's own words; a day alone isn't one", () => {
    for (const q of ["Schedule this for Friday at 8pm", "Move my next post to Sunday 9pm", "جدول هذا المنشور يوم الجمعة الساعة 8 مساءً", "٨ مساءً", "at 20:00", "Tomorrow at noon", "9 am"]) assert.ok(mentionsClockTime(q), q);
    for (const q of ["Schedule it tomorrow", "Schedule for 6 Nov", "Friday evening", "جدولها بكرة"]) assert.ok(!mentionsClockTime(q), q);
  });

  it("asks for the time when the model filled one in that the owner never gave", () => {
    const now = Date.parse("2026-11-03T11:05:00Z");
    const raw: RawChatAction = { type: "schedule", post: "P1", caption: null, hashtags: null, photo: null, date: "2026-11-04", time: "20:00" };
    const refs: ChatPostRef[] = [{ ref: "P1", kind: "card", messageId: "m1", draftId: null, jobId: null, status: "unsaved", caption: "x", photos: 1 }];
    assert.deepEqual(decideAction(raw, refs, { timeZone: "Asia/Kuwait", now, attachedPhotos: 0, question: "Schedule it tomorrow" }), { kind: "ask", reason: "when", type: "schedule" });
    assert.equal(decideAction(raw, refs, { timeZone: "Asia/Kuwait", now, attachedPhotos: 0, question: "Schedule it tomorrow at 8pm" }).kind, "propose");
  });

  it("never reports a caption change as saved when the model wrote no new caption", () => {
    assert.ok(wantsCaptionChange("Make the caption shorter and save it"));
    assert.ok(wantsCaptionChange("اختصر الكابشن واحفظه"));
    assert.ok(!wantsCaptionChange("Save it"));
    const refs: ChatPostRef[] = [{ ref: "P1", kind: "card", messageId: "m1", draftId: null, jobId: null, status: "unsaved", caption: "x", photos: 1 }];
    const raw: RawChatAction = { type: "save_draft", post: "P1", caption: null, hashtags: null, photo: null, date: null, time: null };
    const ctx = { timeZone: "Asia/Kuwait", now: 0, attachedPhotos: 0 };
    assert.deepEqual(decideAction(raw, refs, { ...ctx, question: "Make the caption shorter and save it" }), { kind: "ask", reason: "caption_missing", type: "save_draft" });
    assert.equal(decideAction(raw, refs, { ...ctx, question: "Save it" }).kind, "save");
  });

  it("makes the model fill every action field (null when it doesn't apply)", () => {
    const action = (chatAnswerSchema(["save_draft", "schedule"]).properties as Record<string, { required?: string[] }>).action;
    assert.deepEqual(action.required, ["type", "post", "caption_en", "caption_ar", "hashtags", "photo", "date", "time"]);
  });
});

// Tuesday 3 Nov 2026, 14:05 in Kuwait (UTC+3).
const NOW = Date.parse("2026-11-03T11:05:00Z");
const TZ = "Asia/Kuwait";

const card = (over: Partial<ChatPostRef> = {}): ChatPostRef => ({ ref: "P1", kind: "card", messageId: "m1", draftId: null, jobId: null, status: "unsaved", caption: "Fresh bread", photos: 1, ...over });
const sched = (over: Partial<ChatPostRef> = {}): ChatPostRef => ({ ref: "S1", kind: "scheduled", draftId: "d9", jobId: "j9", status: "scheduled", at: "2026-11-04T17:00:00.000Z", caption: "Tomorrow's post", photos: 1, ...over });
const raw = (over: Partial<RawChatAction>): RawChatAction => ({ type: "schedule", post: "P1", caption: null, hashtags: null, photo: null, date: null, time: null, ...over });
const ctx = { timeZone: TZ, now: NOW, attachedPhotos: 0 };

describe("AI actions: times in the business's time zone", () => {
  it("turns a local date and time into the instant (Kuwait is UTC+3)", () => {
    const r = resolveLocalTime("2026-11-06", "20:00", TZ, NOW);
    assert.ok(r.ok);
    assert.equal(r.at.toISOString(), "2026-11-06T17:00:00.000Z");
    const pm = resolveLocalTime("2026-11-06", "8:00 PM", TZ, NOW);
    assert.ok(pm.ok && pm.at.toISOString() === "2026-11-06T17:00:00.000Z");
    const noon = resolveLocalTime("2026-11-06", "12:00 am", TZ, NOW);
    assert.ok(noon.ok && noon.at.toISOString() === "2026-11-05T21:00:00.000Z");
  });

  it("asks when the day or the time is missing or unreadable", () => {
    assert.deepEqual(resolveLocalTime("2026-11-06", null, TZ, NOW), { ok: false, problem: "when" });
    assert.deepEqual(resolveLocalTime(null, "20:00", TZ, NOW), { ok: false, problem: "when" });
    assert.deepEqual(resolveLocalTime("Friday", "20:00", TZ, NOW), { ok: false, problem: "when" });
    assert.deepEqual(resolveLocalTime("2026-02-31", "20:00", TZ, NOW), { ok: false, problem: "when" });
    assert.deepEqual(resolveLocalTime("2026-11-06", "25:00", TZ, NOW), { ok: false, problem: "when" });
  });

  it("refuses a time that has passed (today, earlier) or is too far ahead", () => {
    assert.deepEqual(resolveLocalTime("2026-11-03", "14:00", TZ, NOW), { ok: false, problem: "past" });
    assert.ok(resolveLocalTime("2026-11-03", "20:00", TZ, NOW).ok);
    assert.deepEqual(resolveLocalTime("2027-06-01", "20:00", TZ, NOW), { ok: false, problem: "too_far" });
  });

  it("tells the AI today's date in the time zone", () => {
    assert.equal(todayLine(NOW, TZ), "Today is Tuesday 2026-11-03, 14:05 (Asia/Kuwait time).");
    // Late evening UTC is already the next day in Kuwait.
    assert.equal(localStamp(new Date("2026-11-03T22:30:00Z"), TZ), "Wednesday 2026-11-04 01:30");
  });
});

describe("AI actions: deciding what to do, or asking", () => {
  it("proposes scheduling the newest card at the asked time", () => {
    const d = decideAction(raw({ date: "2026-11-06", time: "20:00" }), [card()], ctx);
    assert.equal(d.kind, "propose");
    assert.ok(d.kind === "propose" && d.type === "schedule" && d.at?.toISOString() === "2026-11-06T17:00:00.000Z");
  });

  it("asks for the time instead of guessing (a day without an hour)", () => {
    assert.deepEqual(decideAction(raw({ date: "2026-11-06" }), [card()], ctx), { kind: "ask", reason: "when", type: "schedule" });
  });

  it("asks which post when several could be meant, and uses the only one when the AI named none", () => {
    const two = [card(), card({ ref: "P2", messageId: "m2" })];
    assert.deepEqual(decideAction(raw({ post: null, date: "2026-11-06", time: "20:00" }), two, ctx), { kind: "ask", reason: "which_post", type: "schedule" });
    assert.equal(decideAction(raw({ post: null, date: "2026-11-06", time: "20:00" }), [card()], ctx).kind, "propose");
    // A card and its own scheduled entry are one post.
    const same = [card({ draftId: "d9", jobId: "j9", status: "scheduled" }), sched()];
    assert.equal(decideAction(raw({ type: "cancel", post: null }), same, ctx).kind, "propose");
    assert.deepEqual(decideAction(raw({ post: "P1" }), [], ctx), { kind: "ask", reason: "no_post", type: "schedule" });
  });

  it("moves a post that's already scheduled instead of scheduling it twice; post now on it is 'now'", () => {
    const d = decideAction(raw({ post: "S1", date: "2026-11-07", time: "09:00" }), [sched()], ctx);
    assert.ok(d.kind === "propose" && d.type === "reschedule");
    const now = decideAction(raw({ type: "post_now", post: "S1" }), [sched()], ctx);
    assert.ok(now.kind === "propose" && now.type === "reschedule" && now.at === null);
    const fresh = decideAction(raw({ type: "post_now" }), [card()], ctx);
    assert.ok(fresh.kind === "propose" && fresh.type === "post_now");
  });

  it("cancels only scheduled (or failed) posts", () => {
    assert.ok(decideAction(raw({ type: "cancel", post: "S1" }), [sched()], ctx).kind === "propose");
    assert.deepEqual(decideAction(raw({ type: "cancel", post: "P1" }), [card()], ctx), { kind: "ask", reason: "not_scheduled", type: "cancel" });
    assert.deepEqual(decideAction(raw({ type: "cancel", post: null }), [card()], ctx), { kind: "ask", reason: "not_scheduled", type: "cancel" });
  });

  it("never touches a post that's on Instagram or being posted", () => {
    assert.deepEqual(decideAction(raw({ post: "P1", date: "2026-11-06", time: "20:00" }), [card({ status: "posted", draftId: "d1" })], ctx), { kind: "ask", reason: "posted", type: "schedule" });
    assert.deepEqual(decideAction(raw({ type: "save_draft" }), [card({ status: "publishing", draftId: "d1" })], ctx), { kind: "ask", reason: "publishing", type: "save_draft" });
  });

  it("saves a draft straight away; a new photo needs one attached and a draft that isn't scheduled", () => {
    const d = decideAction(raw({ type: "save_draft", caption: { en: "Short", ar: "قصير" } }), [card()], ctx);
    assert.ok(d.kind === "save" && d.caption?.en === "Short" && !d.photo);
    assert.deepEqual(decideAction(raw({ type: "save_draft", photo: "attached" }), [card()], ctx), { kind: "ask", reason: "no_photo", type: "save_draft" });
    assert.ok(decideAction(raw({ type: "save_draft", photo: "attached" }), [card()], { ...ctx, attachedPhotos: 1 }).kind === "save");
    assert.deepEqual(decideAction(raw({ type: "save_draft", photo: "attached" }), [card({ status: "scheduled", draftId: "d1", jobId: "j1" })], { ...ctx, attachedPhotos: 1 }), {
      kind: "ask",
      reason: "photo_locked",
      type: "save_draft",
    });
  });
});

describe("AI actions: the answer and the post list", () => {
  it("reads the JSON answer; an action that isn't switched on is dropped, a caption needs both languages", () => {
    const answer = { reply: "Sure.", ask: null, action: { type: "schedule", post: "p1", date: "2026-11-06", time: "20:00", caption_en: "Only English" } };
    const parsed = parseChatAnswer(answer, ["save_draft", "schedule"]);
    assert.equal(parsed.reply, "Sure.");
    assert.deepEqual(parsed.action, { type: "schedule", post: "P1", caption: null, hashtags: null, photo: null, date: "2026-11-06", time: "20:00" });
    assert.equal(parseChatAnswer(answer, ["save_draft"]).action, null);
    const tags = parseChatAnswer({ reply: "", action: { type: "save_draft", caption_en: "A", caption_ar: "ب", hashtags: ["#Bread", "Bread", "#Kuwait Food"] } }, ["save_draft"]).action;
    assert.deepEqual(tags?.caption, { en: "A", ar: "ب" });
    assert.deepEqual(tags?.hashtags, ["#Bread", "#KuwaitFood"]);
    assert.deepEqual(chatAnswerSchema(["save_draft"]).required, ["reply", "ask", "action"]);
    assert.deepEqual(chatAnswerSchema([]).required, ["reply"]);
  });

  it("lists posts by ref with their state and local time, never their ids", () => {
    const lines = postRefLines([card({ caption: "Fresh <b>bread</b>" }), sched()], TZ).join("\n");
    assert.match(lines, /- P1: post card in this chat \(the newest one\), not saved yet, 1 photo, caption: "Fresh bbread\/b"/);
    assert.match(lines, /- S1: scheduled post, scheduled for Wednesday 2026-11-04 20:00/);
    assert.doesNotMatch(lines, /d9|j9|m1/);
    assert.match(postRefLines([], TZ).join("\n"), /None/);
    // Today / tomorrow are named in the business's time zone (S1 is Wednesday 20:00 Kuwait; today is Tuesday).
    assert.match(postRefLines([sched()], TZ, NOW).join("\n"), /scheduled for Wednesday 2026-11-04 20:00 \(tomorrow\)/);
    assert.match(postRefLines([sched({ at: "2026-11-03T17:00:00.000Z" })], TZ, NOW).join("\n"), /20:00 \(today\)/);
  });
});

describe("AI actions: in the browser", () => {
  it("sends 'do something' questions to the AI (EN + AR)", () => {
    for (const q of ["Schedule this for Friday at 8pm", "Make the caption shorter and save it", "Cancel tomorrow's post", "Post it now", "Move my next post to Sunday 9pm", "Move tomorrow's post to Saturday", "جدول المنشور الجمعة 8 مساءً", "الغ منشور بكرة", "احفظ المسودة"]) assert.ok(asksForAction(q), q);
    for (const q of ["How are my posts doing?", "What should I post next?", "متى أفضل وقت للنشر؟", "Which posts moved people the most?"]) assert.ok(!asksForAction(q), q);
  });

  it("knows what needs approval and when a proposal expired", () => {
    assert.equal(needsApproval("save_draft"), false);
    assert.equal(needsApproval("cancel"), true);
    assert.equal(isExpired({ status: "proposed", expiresAt: new Date(NOW - 1).toISOString() }, NOW), true);
    assert.equal(isExpired({ status: "done", expiresAt: new Date(NOW - 1).toISOString() }, NOW), false);
  });
});
