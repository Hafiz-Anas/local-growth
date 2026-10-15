/**
 * Pure rules for the reply approval queue (Engagement), shared by the API and the UI:
 * Instagram's limits for a reply, how a sent reply compares with the AI's draft, and the
 * anonymised "how the business edits drafts" examples the AI learns from. No server imports.
 */

/** Instagram rejects longer public replies to comments through the API. */
export const COMMENT_REPLY_MAX = 300;
/** …and public replies with more hashtags or links than this. */
export const COMMENT_REPLY_MAX_HASHTAGS = 4;
export const COMMENT_REPLY_MAX_LINKS = 1;
/** Instagram DMs (replies to a conversation and private replies to a comment). */
export const DM_REPLY_MAX = 1000;
/** Instagram accepts a DM reply for 24 hours after the customer's last message. */
export const DM_WINDOW_HOURS = 24;
/** Under this many hours left, the queue warns that the DM window is closing. */
export const DM_WINDOW_WARN_HOURS = 3;

export type ReplyChannel = "comment" | "dm";

export function replyLimit(channel: ReplyChannel): number {
  return channel === "dm" ? DM_REPLY_MAX : COMMENT_REPLY_MAX;
}

export type ReplyProblem = "empty" | "too_long" | "too_many_hashtags" | "too_many_links";

const HASHTAG = /(^|\s)#[\p{L}\p{N}_]+/gu;
const LINK = /\bhttps?:\/\/\S+|\bwww\.\S+/giu;

/** Why Instagram would refuse this reply, or null when it can be sent. `allowEmpty`: keyword drafts that only send their DM. */
export function replyProblem(text: string, channel: ReplyChannel, options: { allowEmpty?: boolean } = {}): ReplyProblem | null {
  const trimmed = text.trim();
  if (!trimmed) return options.allowEmpty ? null : "empty";
  if (trimmed.length > replyLimit(channel)) return "too_long";
  if (channel === "comment") {
    if ((trimmed.match(HASHTAG) ?? []).length > COMMENT_REPLY_MAX_HASHTAGS) return "too_many_hashtags";
    if ((trimmed.match(LINK) ?? []).length > COMMENT_REPLY_MAX_LINKS) return "too_many_links";
  }
  return null;
}

// ── Sent as-is / edited / written by hand ─────────────────────────────────────

export type ReplyOutcome = "as_is" | "edited" | "manual";

const normalize = (text: string) => text.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
const words = (text: string) => normalize(text).match(/[\p{L}\p{N}]+/gu) ?? [];

/** Share of words the two texts have in common (Dice coefficient over word multisets), 0–1. */
export function wordOverlap(a: string, b: string): number {
  const wa = words(a);
  const wb = words(b);
  if (!wa.length && !wb.length) return 1;
  if (!wa.length || !wb.length) return 0;
  const counts = new Map<string, number>();
  for (const w of wa) counts.set(w, (counts.get(w) ?? 0) + 1);
  let shared = 0;
  for (const w of wb) {
    const n = counts.get(w) ?? 0;
    if (n > 0) {
      shared += 1;
      counts.set(w, n - 1);
    }
  }
  return (2 * shared) / (wa.length + wb.length);
}

/** Below this overlap with the draft, the reply counts as written by the business itself. */
export const MANUAL_OVERLAP = 0.3;

/** How the sent reply relates to what the AI (or keyword rule) proposed. */
export function replyOutcome(proposed: string | null | undefined, sent: string): ReplyOutcome {
  const draft = proposed ?? "";
  if (normalize(draft) === normalize(sent)) return "as_is";
  if (!draft.trim() || wordOverlap(draft, sent) < MANUAL_OVERLAP) return "manual";
  return "edited";
}

export interface OutcomeCounts {
  as_is: number;
  edited: number;
  manual: number;
}

/** Percentage (0–100, rounded) of replies sent as the AI drafted them, or null with nothing sent. */
export function asIsRate(counts: OutcomeCounts): number | null {
  const total = counts.as_is + counts.edited + counts.manual;
  return total ? Math.round((counts.as_is / total) * 100) : null;
}

// ── Learning from edits ───────────────────────────────────────────────────────

export interface EditExample {
  draft: string;
  sent: string;
}

/** Longest draft/sent text kept in an example (the prompt stays small). */
export const EXAMPLE_MAX_CHARS = 280;
export const MAX_EDIT_EXAMPLES = 3;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Removes customer details from a reply before it becomes an example in a prompt: the
 * customer's name/handle (→ "{name}"), @mentions, email addresses and phone numbers.
 * The business's own words stay — they are what the AI should learn.
 */
export function scrubReply(text: string, names: string[] = []): string {
  let out = text;
  const parts = new Set<string>();
  for (const raw of names) {
    const name = raw.trim().replace(/^@/, "");
    if (name.length < 2) continue;
    parts.add(name);
    // A handle like "sara.k_92" is greeted as "Sara": drop each alphabetic piece of it too.
    for (const piece of name.split(/[._\d\s-]+/)) if (piece.length >= 3) parts.add(piece);
  }
  for (const part of [...parts].sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])@?${escape(part)}(?![\\p{L}\\p{N}])`, "giu"), "{name}");
  }
  return out
    .replace(/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[a-z]{2,}/giu, "{email}")
    .replace(/(^|[^\p{L}\p{N}])@[\p{L}\p{N}._]+/gu, "$1{name}")
    .replace(/\+?\d[\d\s-]{6,}\d/g, "{phone}")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

const LATIN_GREETING = /(?:^|[^\p{L}])(?:[Hh]i|[Hh]ello|[Hh]ey|[Dd]ear|[Tt]hanks|[Tt]hank you|[Ww]elcome(?: back)?|[Gg]ood (?:morning|evening)),?\s+(\p{Lu}\p{Ll}+)/gu;
const ARABIC_GREETING = /(?:^|[^\p{L}])(?:هلا|هلا والله|مرحبا|مرحباً|أهلاً|أهلا|اهلا|شكراً|شكرا|حياك|حياكم|عزيزتي|عزيزي)\s+(\p{L}+)/gu;
const NOT_NAMES = new Set(["I", "I'm", "We", "You", "The", "This", "That", "Is", "Do", "Does", "Can", "What", "When", "Where", "How", "Hi", "Hello", "Thanks", "Please"]);

/**
 * Words in a reply that are probably the customer's name, so they can be removed: a capitalised
 * word right after a greeting ("Hi Sara"), an Arabic word after a greeting when the customer used it
 * too, and capitalised words from the middle of the customer's own message ("I'm Sara").
 * The customer's message is only read here — it never goes into an example.
 */
export function nameCandidates(reply: string, customerText = ""): string[] {
  const names = new Set<string>();
  for (const m of reply.matchAll(LATIN_GREETING)) if (!NOT_NAMES.has(m[1])) names.add(m[1]);
  const customerWords = new Set(customerText.match(/\p{L}+/gu) ?? []);
  for (const m of reply.matchAll(ARABIC_GREETING)) if (customerWords.has(m[1])) names.add(m[1]);
  for (const sentence of customerText.split(/[.!?؟\n]+/)) {
    const words = sentence.trim().split(/\s+/).slice(1);
    for (const w of words) {
      const word = w.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
      if (/^\p{Lu}\p{Ll}+$/u.test(word) && !NOT_NAMES.has(word)) names.add(word);
    }
  }
  return [...names];
}

export interface SentReplyRow {
  /** What the AI proposed. */
  aiReply: string | null;
  /** What was actually sent. */
  draftReply: string;
  commenterUsername: string;
  /** The customer's message: only used to spot their name, never copied into an example. */
  commentText?: string;
}

/**
 * A few recent "AI draft → what the business sent instead" pairs, newest first, with customer
 * details removed. Rows are the business's sent AI replies whose text was changed, newest first.
 */
export function pickEditExamples(rows: SentReplyRow[], max = MAX_EDIT_EXAMPLES): EditExample[] {
  const examples: EditExample[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (examples.length >= max) break;
    if (!row.aiReply?.trim() || replyOutcome(row.aiReply, row.draftReply) === "as_is") continue;
    const names = [row.commenterUsername, ...nameCandidates(row.aiReply, row.commentText), ...nameCandidates(row.draftReply, row.commentText)];
    const draft = scrubReply(row.aiReply, names).slice(0, EXAMPLE_MAX_CHARS);
    const sent = scrubReply(row.draftReply, names).slice(0, EXAMPLE_MAX_CHARS);
    if (!sent || seen.has(normalize(sent))) continue;
    seen.add(normalize(sent));
    examples.push({ draft, sent });
  }
  return examples;
}

// ── Regenerate ────────────────────────────────────────────────────────────────

export const REGENERATE_TONES = ["shorter", "formal", "friendly"] as const;
export type RegenerateTone = (typeof REGENERATE_TONES)[number];

/** Whole hours (at least 1) until the DM window closes, or 0 when it has closed. */
export function hoursLeft(replyBy: string | Date, now = Date.now()): number {
  const ms = new Date(replyBy).getTime() - now;
  return ms <= 0 ? 0 : Math.max(1, Math.ceil(ms / 3_600_000));
}
