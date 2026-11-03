import { CHAT_ACTION_TYPES, type ChatActionType } from "../../gallery/chat-actions";
import { zonedParts, zonedTimeToUtc } from "../../time";
import { normalizeHashtag } from "./output";

/**
 * AI tab actions (AI4), the pure parts: the posts the AI may act on (as short refs, never ids), the
 * answer's JSON shape, reading the AI's answer, turning a local date + time into an instant in the
 * business's time zone, and deciding what to do — or what to ask, instead of guessing. Pure (no
 * server-only) so it's unit-tested (tests/chat-actions.test.ts); lib/server/chat-actions.ts loads the
 * data and runs the actions with the existing draft and publishing services.
 */

/** How far ahead a post can be scheduled from the chat. */
export const ACTION_MAX_DAYS = 90;
/** Upcoming scheduled posts listed for the AI. */
export const ACTION_UPCOMING_MAX = 10;
/** Post cards of the chat listed for the AI (newest first). */
export const ACTION_CARDS_MAX = 5;
const DAY = 24 * 60 * 60 * 1000;

export type PostRefStatus = "unsaved" | "draft" | "scheduled" | "publishing" | "failed" | "posted";

/** A post the AI may act on: a post card of this chat (P1 = newest) or an upcoming scheduled post (S1 = soonest). */
export interface ChatPostRef {
  ref: string;
  kind: "card" | "scheduled";
  /** The card's chat message (cards only). */
  messageId?: string;
  draftId?: string | null;
  /** The draft's active (or last failed) publishing job. */
  jobId?: string | null;
  status: PostRefStatus;
  /** When it's scheduled for (scheduled / failed). */
  at?: string | null;
  caption: string;
  photos: number;
}

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const pad = (n: number) => String(n).padStart(2, "0");

/** "Friday 2026-11-06 20:00" in the time zone (what the AI reads and answers in). */
export function localStamp(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  const weekday = WEEKDAY[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()];
  return `${weekday} ${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}

const STATUS_TEXT: Record<PostRefStatus, string> = {
  unsaved: "not saved yet",
  draft: "saved as a draft, not scheduled",
  scheduled: "scheduled",
  publishing: "being posted right now (can't be changed)",
  failed: "couldn't be posted (can be tried again or cancelled)",
  posted: "already on Instagram (can't be changed)",
};

/** The "## Posts you can act on" block: one line per ref, captions cut and made safe. */
export function postRefLines(refs: ChatPostRef[], timeZone: string, now?: number): string[] {
  // "(today)" / "(tomorrow)" next to those days: the model matches "tomorrow's post" reliably then (it missed it once without).
  const day = (t: number) => localStamp(new Date(t), timeZone).split(" ")[1];
  const relative = (iso: string) => (now === undefined ? "" : day(Date.parse(iso)) === day(now) ? " (today)" : day(Date.parse(iso)) === day(now + 86_400_000) ? " (tomorrow)" : "");
  if (!refs.length) return ["## Posts you can act on", "- None: there's no post card in this chat and nothing is scheduled."];
  return [
    "## Posts you can act on",
    ...refs.map((r) => {
      const where = r.kind === "card" ? `post card in this chat${r.ref === "P1" ? " (the newest one)" : ""}` : "scheduled post";
      const when = r.at && (r.status === "scheduled" || r.status === "failed") ? ` for ${localStamp(new Date(r.at), timeZone)}${relative(r.at)}` : "";
      const caption = r.caption.replace(/\s+/g, " ").replace(/[<>]/g, "").slice(0, 120);
      return `- ${r.ref}: ${where}, ${STATUS_TEXT[r.status]}${when}, ${r.photos} photo${r.photos === 1 ? "" : "s"}, caption: "${caption}${r.caption.length > 120 ? "…" : ""}"`;
    }),
  ];
}

/** The tools the AI may use, in its own words (only the ones this business has switched on). */
export function toolLines(types: readonly ChatActionType[]): string[] {
  const text: Record<ChatActionType, string> = {
    save_draft: "save_draft — save a post card as a draft, or change a post's caption/hashtags (caption_en AND caption_ar, both full rewrites) or its photo (photo: \"attached\" = the photo sent with this message). Saved at once.",
    schedule: "schedule — schedule a post for date + time. The owner approves it first.",
    post_now: "post_now — post it on Instagram now. The owner approves it first.",
    reschedule: "reschedule — move a scheduled post to date + time. The owner approves it first.",
    cancel: "cancel — cancel a scheduled post (it goes back to the drafts). The owner approves it first.",
  };
  return types.map((t) => `- ${text[t]}`);
}

/** Gemini responseSchema for a chat answer: the reply, an optional question back, an optional action. */
export function chatAnswerSchema(types: readonly ChatActionType[]): Record<string, unknown> {
  if (!types.length) return { type: "object", properties: { reply: { type: "string" }, ask: { type: "string", nullable: true } }, required: ["reply"] };
  return {
    type: "object",
    properties: {
      reply: { type: "string" },
      ask: { type: "string", nullable: true },
      action: {
        type: "object",
        nullable: true,
        // Every key is required (null when it doesn't apply): a lighter model otherwise leaves out the date or the
        // new caption it was asked for (seen with gemini-3.5-flash-lite on 2026-11-03).
        properties: {
          type: { type: "string", enum: [...types] },
          post: { type: "string", nullable: true, description: "One ref from \"Posts you can act on\", e.g. P1 or S1." },
          caption_en: { type: "string", nullable: true, description: "The full new English caption (no hashtags) when the owner asked to change the caption; otherwise null." },
          caption_ar: { type: "string", nullable: true, description: "The full new Arabic caption (no hashtags) when the owner asked to change the caption; otherwise null." },
          hashtags: { type: "array", items: { type: "string" }, nullable: true, description: "New hashtags only when the owner asked to change them; otherwise null." },
          photo: { type: "string", enum: ["attached"], nullable: true, description: "\"attached\" to use the photo sent with this message; otherwise null." },
          date: { type: "string", nullable: true, description: "schedule / reschedule: the day as YYYY-MM-DD in the business's time zone (work out \"Friday\", \"tomorrow\" from today's date). Null for other actions." },
          time: { type: "string", nullable: true, description: "schedule / reschedule: HH:MM (24-hour) exactly as the owner said it. Null when the owner gave no time — then ask instead." },
        },
        required: ["type", "post", "caption_en", "caption_ar", "hashtags", "photo", "date", "time"],
      },
    },
    required: ["reply", "ask", "action"],
  };
}

/** What the AI asked for, before it's checked against the posts and the clock. */
export interface RawChatAction {
  type: ChatActionType;
  post: string | null;
  caption: { en: string; ar: string } | null;
  hashtags: string[] | null;
  photo: "attached" | null;
  date: string | null;
  time: string | null;
}

export interface ParsedChatAnswer {
  reply: string;
  ask: string | null;
  action: RawChatAction | null;
}

const str = (x: unknown) => (typeof x === "string" ? x.trim() : "");

/** The model's JSON answer; an action of a type that isn't allowed is dropped (the reply still counts). */
export function parseChatAnswer(json: unknown, types: readonly ChatActionType[]): ParsedChatAnswer {
  const record = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const a = (record.action && typeof record.action === "object" ? record.action : null) as Record<string, unknown> | null;
  const type = str(a?.type) as ChatActionType;
  let action: RawChatAction | null = null;
  if (a && (CHAT_ACTION_TYPES as readonly string[]).includes(type) && types.includes(type)) {
    const en = str(a.caption_en);
    const ar = str(a.caption_ar);
    const tags = Array.isArray(a.hashtags) ? [...new Set(a.hashtags.filter((t): t is string => typeof t === "string").map(normalizeHashtag).filter(Boolean))].slice(0, 30) : null;
    action = {
      type,
      post: str(a.post).toUpperCase() || null,
      // Both languages or neither: a draft keeps its caption in English and Arabic.
      caption: en && ar ? { en, ar } : null,
      hashtags: tags && tags.length ? tags : null,
      photo: a.photo === "attached" ? "attached" : null,
      date: str(a.date) || null,
      time: str(a.time) || null,
    };
  }
  return { reply: str(record.reply), ask: str(record.ask) || null, action };
}

export type TimeProblem = "when" | "past" | "too_far";

/**
 * "2026-11-06" + "20:00" (or "8:00 PM") on the business's wall clock → the instant. Missing or unreadable
 * date/time → "when" (ask); earlier than a minute from now → "past"; more than ACTION_MAX_DAYS ahead → "too_far".
 */
export function resolveLocalTime(date: string | null, time: string | null, timeZone: string, now: number): { ok: true; at: Date } | { ok: false; problem: TimeProblem } {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? "");
  const t = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?$/i.exec(time ?? "");
  if (!d || !t) return { ok: false, problem: "when" };
  let hour = Number(t[1]);
  const minute = Number(t[2]);
  const meridiem = t[3]?.toLowerCase().replace(/\./g, "");
  if (meridiem) {
    if (hour < 1 || hour > 12) return { ok: false, problem: "when" };
    hour = (hour % 12) + (meridiem === "pm" ? 12 : 0);
  }
  const [year, month, day] = [Number(d[1]), Number(d[2]), Number(d[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return { ok: false, problem: "when" };
  // A date that doesn't exist (31 Feb) rolls over: refuse it rather than move the post.
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCDate() !== day) return { ok: false, problem: "when" };
  const at = zonedTimeToUtc({ year, month, day, hour, minute }, timeZone);
  if (at.getTime() <= now + 60_000) return { ok: false, problem: "past" };
  if (at.getTime() > now + ACTION_MAX_DAYS * DAY) return { ok: false, problem: "too_far" };
  return { ok: true, at };
}

export type AskReason = "no_post" | "which_post" | "no_photo" | "when" | "past" | "too_far" | "not_scheduled" | "posted" | "publishing" | "photo_locked" | "caption_missing" | "failed";

export type ActionDecision =
  | { kind: "ask"; reason: AskReason; type: ChatActionType }
  | { kind: "save"; target: ChatPostRef; caption: { en: string; ar: string } | null; hashtags: string[] | null; photo: boolean }
  | { kind: "propose"; type: "schedule" | "post_now" | "reschedule" | "cancel"; target: ChatPostRef; at: Date | null };

const changeable = (r: ChatPostRef) => r.status !== "posted" && r.status !== "publishing";
const hasJob = (r: ChatPostRef) => !!r.jobId && (r.status === "scheduled" || r.status === "failed");

/** The post the action is about: the one named, else the only possible one; never a guess between several. */
function pickTarget(raw: RawChatAction, refs: ChatPostRef[], fits: (r: ChatPostRef) => boolean): ChatPostRef | AskReason {
  if (raw.post) {
    const named = refs.find((r) => r.ref === raw.post);
    if (named) return named;
  }
  const candidates = refs.filter(fits);
  // Several refs can be one post (its card and its scheduled entry): count posts, not refs.
  const posts = new Set(candidates.map((r) => r.draftId ?? r.messageId ?? r.ref));
  if (posts.size === 1) return candidates[0];
  return candidates.length ? "which_post" : "no_post";
}

/**
 * What to do with the AI's action — run it, propose it for approval, or ask the owner (which post, what time,
 * which photo) instead of guessing. Times are the business's wall clock (`timeZone`).
 */
export function decideAction(raw: RawChatAction, refs: ChatPostRef[], ctx: { timeZone: string; now: number; attachedPhotos: number; question?: string }): ActionDecision {
  const ask = (reason: AskReason): ActionDecision => ({ kind: "ask", reason, type: raw.type });
  // The hour comes from the owner, never from the model: no clock time in what they wrote → ask.
  const time = () => (ctx.question !== undefined && !mentionsClockTime(ctx.question) ? ({ ok: false, problem: "when" } as const) : resolveLocalTime(raw.date, raw.time, ctx.timeZone, ctx.now));

  if (raw.type === "save_draft") {
    const target = pickTarget(raw, refs, (r) => r.kind === "card" && changeable(r));
    if (typeof target === "string") return ask(target);
    if (target.status === "posted") return ask("posted");
    if (target.status === "publishing") return ask("publishing");
    if (raw.photo && !ctx.attachedPhotos) return ask("no_photo");
    // Scheduled posts have their photos prepared for Instagram already: the photo changes only on a draft.
    if (raw.photo && target.status !== "unsaved" && target.status !== "draft") return ask("photo_locked");
    if (!target.photos && !raw.photo) return ask("no_photo");
    // Asked for a new caption but the AI didn't write one: say so, never "saved" with the old caption.
    if (ctx.question !== undefined && wantsCaptionChange(ctx.question) && !raw.caption) return ask("caption_missing");
    return { kind: "save", target, caption: raw.caption, hashtags: raw.hashtags, photo: !!raw.photo };
  }

  if (raw.type === "cancel") {
    const target = pickTarget(raw, refs, hasJob);
    if (typeof target === "string") return ask(target === "no_post" ? "not_scheduled" : target);
    if (target.status === "posted") return ask("posted");
    if (target.status === "publishing") return ask("publishing");
    if (!hasJob(target)) return ask("not_scheduled");
    return { kind: "propose", type: "cancel", target, at: null };
  }

  if (raw.type === "reschedule") {
    const target = pickTarget(raw, refs, hasJob);
    if (typeof target === "string") return ask(target === "no_post" ? "not_scheduled" : target);
    if (target.status === "posted") return ask("posted");
    if (target.status === "publishing") return ask("publishing");
    if (!hasJob(target)) return ask("not_scheduled");
    const when = time();
    if (!when.ok) return ask(when.problem);
    return { kind: "propose", type: "reschedule", target, at: when.at };
  }

  // schedule / post_now: a post card or a scheduled post (then it's moved).
  const target = pickTarget(raw, refs, (r) => changeable(r) && r.photos > 0);
  if (typeof target === "string") return ask(target);
  if (target.status === "posted") return ask("posted");
  if (target.status === "publishing") return ask("publishing");
  if (!target.photos) return ask("no_photo");
  if (raw.type === "post_now") return { kind: "propose", type: hasJob(target) ? "reschedule" : "post_now", target, at: null };
  const when = time();
  if (!when.ok) return ask(when.problem);
  return { kind: "propose", type: hasJob(target) ? "reschedule" : "schedule", target, at: when.at };
}

/** A clock time in the owner's own words: "8pm", "20:00", "9 am", "noon", "الساعة 8", "٨ مساءً". A day alone isn't one. */
export function mentionsClockTime(text: string): boolean {
  return /\b\d{1,2}(:\d{2})?\s*(am|pm|a\.m\.|p\.m\.|o'?clock)(?![a-z])|\b\d{1,2}:\d{2}\b|\b(noon|midnight)\b|الساعة|الظهر|ظهرًا|ظهرا|منتصف الليل|[0-9٠-٩]{1,2}\s*(صباحًا|صباحا|مساءً|مساء|ص|م)(?![\u0600-\u06FF])/i.test(text);
}

/** The owner asked for a different caption ("make the caption shorter", "rewrite the caption", "اختصر الكابشن"). */
export function wantsCaptionChange(text: string): boolean {
  return /\b(caption|text)\b.*\b(shorter|longer|change|edit|rewrite|update|simpler|friendlier|formal)\b|\b(shorter|longer|change|edit|rewrite|update|shorten|simplify)\b.*\b(caption|text)\b|الكابشن|الوصف|اختصر|قصّر/i.test(text);
}

/** "Today is Tuesday 2026-11-03, 14:05 (Asia/Kuwait time)." */
export function todayLine(now: number, timeZone: string): string {
  const [weekday, date, clock] = localStamp(new Date(now), timeZone).split(" ");
  return `Today is ${weekday} ${date}, ${clock} (${timeZone} time).`;
}
