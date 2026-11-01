import type { AssistantFacts } from "./assistant";
import { isArabic } from "./output";
import { tipUsesOnlyGivenNumbers } from "./strategy";

/**
 * The AI tab's free-typed questions (components/ai-chat): the business facts block sent with each one
 * (which sections, cut to size, what we can't tell yet), the chat's earlier turns as history, and the
 * check that every number in the answer is in the facts. Pure (no server-only) so it can be unit-tested;
 * lib/server/chat-facts.ts loads the data and app/api/ai-chat/route.ts puts it together.
 */

/** The modes chats used to have; older tabs may still send one, which the API ignores. */
export const AI_CHAT_MODES = ["post", "analytics", "competitors"] as const;
export const AI_CHAT_MAX_QUESTION = 500;
/** Earlier messages of the chat sent with a question (5 questions and answers), each cut to this length. */
export const CHAT_HISTORY_LIMIT = 10;
export const CHAT_HISTORY_CHARS = 600;
/** The facts block's size cap (characters); sections are dropped, least useful first, to fit. */
export const CHAT_FACTS_MAX = 8000;
/** Below this many posts with numbers, "what works best" questions get "not enough posts yet". */
export const CHAT_MIN_POSTS = 4;

/** The answer follows the question: any Arabic letter → Arabic. */
export const questionLanguage = (text: string): "en" | "ar" => (isArabic(text) ? "ar" : "en");

/** The model's answer as plain text: no markdown emphasis or headings, "- " bullets. */
export function cleanChatAnswer(answer: string): string {
  return answer
    .replace(/\r\n/g, "\n")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[*•]\s+/gm, "- ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ─── Which facts a question needs ────────────────────────────────────────────

export const CHAT_TOPICS = ["post", "results", "competitors", "tips", "gallery"] as const;
export type ChatTopic = (typeof CHAT_TOPICS)[number];

const TOPIC_WORDS: Record<ChatTopic, RegExp> = {
  post: /\b(post|posts|posting|caption|hashtag|write|story|stories)\b|منشور|انشر|أنشر|كابشن|هاشتاق|هاشتاغ|اكتب|ستوري/i,
  results: /\b(reach|share|shares|shared|save|saves|saved|comment|comments|like|likes|engag\w*|follower\w*|grow\w*|perform\w*|result\w*|stat\w*|insight\w*|best|worst|top|time|times|day|days|when|week|month|reel|reels|video|carousel|number\w*|analy\w*|doing|work\w*)\b|وصول|مشارك|حفظ|تعليق|إعجاب|اعجاب|تفاعل|متابع|نمو|أداء|اداء|نتائج|نتيجة|إحصائ|احصائ|أفضل|افضل|وقت|يوم|أيام|متى|أسبوع|اسبوع|شهر|ريلز|فيديو|تحليل/i,
  competitors: /\b(compet\w*|rival\w*|other accounts?)\b|@\w|منافس/i,
  tips: /\b(tip|tips|recommend\w*|advice|advise|should|improve|next step|what to do)\b|نصيح|نصائح|توصي|أنصح|انصح|ماذا أفعل|شو أسوي|تحسين/i,
  gallery: /\b(gallery|photo|photos|picture\w*|image\w*|draft\w*|album\w*|upload\w*)\b|معرض|صور|صورة|مسود|ألبوم|البوم/i,
};

/**
 * The sections a question needs. A follow-up that names none ("and on Fridays?") keeps the previous
 * question's topics; a question that names none at all gets every section ("all").
 */
export function chatTopics(question: string, previousQuestion?: string | null): Set<ChatTopic> | "all" {
  const match = (text: string) => new Set(CHAT_TOPICS.filter((t) => TOPIC_WORDS[t].test(text)));
  const now = match(question);
  if (now.size) return now;
  const before = previousQuestion ? match(previousQuestion) : new Set<ChatTopic>();
  return before.size ? before : "all";
}

export const wantsTopic = (topics: Set<ChatTopic> | "all", topic: ChatTopic) => topics === "all" || topics.has(topic);

// ─── The facts block ─────────────────────────────────────────────────────────

/**
 * Text that came from Instagram (captions, competitor notes) can't close the facts block or pose as a tag:
 * angle brackets become look-alikes and each line is cut to `maxLine` characters.
 */
export function neutralizeFacts(text: string, maxLine = 400): string {
  return text
    .replace(/</g, "‹")
    .replace(/>/g, "›")
    .split("\n")
    .map((line) => (line.length > maxLine ? `${line.slice(0, maxLine)}…` : line))
    .join("\n");
}

/** Sections dropped first when the block is too long (matched on the heading's start), least useful first. */
const DROP_ORDER = [
  "## Statistics",
  "## Post monitoring",
  "## Marketing methods",
  "## Gallery",
  "## Content mix",
  "## Competitor analysis",
  "## Posting times",
  "## Shareability",
  "## Tracked competitors",
  "## Recommendations",
  "## Recent posts",
  "## Brand profile",
];

/** The block cut to `max` characters by dropping whole sections in DROP_ORDER (the business section always stays). */
export function fitFacts(block: string, max = CHAT_FACTS_MAX): string {
  if (block.length <= max) return block;
  const sections: string[][] = [[]];
  for (const line of block.split("\n")) {
    if (line.startsWith("## ")) sections.push([]);
    sections.at(-1)!.push(line);
  }
  const size = () => sections.reduce((n, s) => n + s.join("\n").length + 1, 0);
  for (const heading of DROP_ORDER) {
    if (size() <= max) break;
    for (let i = sections.length - 1; i > 0; i--) if (sections[i][0]?.startsWith(heading)) sections.splice(i, 1);
  }
  const text = sections.map((s) => s.join("\n")).join("\n");
  return text.length <= max ? text : text.slice(0, max);
}

export interface ChatFactsExtras {
  /** "## Recommendations" lines (current tips, last week's results), when loaded. */
  recommendations?: string[] | null;
  /** "## Gallery" lines (photo counts, recent drafts), when loaded. */
  gallery?: string[] | null;
  /** Whether competitors were loaded for this question (so "none tracked" can be said). */
  competitorsLoaded?: boolean;
  /** Current tips; null when Recommendations weren't loaded or are off. */
  tips?: number | null;
}

/** Data the app doesn't collect at all (the answer is "We don't track that yet", never "Not enough posts yet"). */
export const NOT_TRACKED =
  "We don't track: visits to a shop or branch, sales, orders or revenue, phone calls, website or link clicks, ad spend or ad results, story views, or anything about competitors beyond their public posts and follower counts.";

/**
 * What the data can't tell yet, said in the block itself so the model has the plain sentence to use
 * ("Not enough posts yet to tell…") instead of guessing.
 */
export function dataGaps(facts: AssistantFacts, extras: ChatFactsExtras = {}): string[] {
  const gaps: string[] = [];
  const status = facts.instagram.status;
  if (status === "not_connected") gaps.push("Instagram isn't connected (or its data couldn't be read), so there are no Instagram numbers to answer from.");
  else if (status === "reconnect_needed") gaps.push("Instagram needs to be reconnected; the numbers below are from the last sync and may be out of date.");
  if (status !== "not_connected") {
    const withReach = (facts.posts ?? []).filter((p) => p.reach > 0).length;
    const stored = facts.posts?.length ?? 0;
    if (stored === 0) gaps.push("No posts stored yet, so nothing can be said about what works.");
    else if (withReach < CHAT_MIN_POSTS)
      gaps.push(`Not enough posts yet to tell what works best: ${withReach} post${withReach === 1 ? "" : "s"} with reach stored (at least ${CHAT_MIN_POSTS} needed).`);
    if (facts.windows && !facts.windows.best) gaps.push("No posting time stands out yet (too few posts).");
  }
  if (extras.competitorsLoaded && !(facts.competitors ?? []).length) gaps.push("No competitors tracked yet (or none could be loaded).");
  if (extras.tips === 0) gaps.push("No Recommendations tips this week yet.");
  return ["", "## What the data can't tell yet", ...gaps.map((g) => `- ${g}`), `- ${NOT_TRACKED}`];
}

/** The facts block: the shared data block, the AI tab's extra sections and the gaps, made safe and cut to size. */
export function chatFactsBlock(formatted: string, facts: AssistantFacts, extras: ChatFactsExtras = {}, max = CHAT_FACTS_MAX): string {
  const block = [formatted, ...(extras.recommendations ?? []), ...(extras.gallery ?? []), ...dataGaps(facts, extras)].join("\n");
  return fitFacts(neutralizeFacts(block), max);
}

// ─── Conversation memory ─────────────────────────────────────────────────────

/** A stored message (AssistantMessage): `content` is set for questions and server-written answers. */
export interface StoredChatMessage {
  role: "USER" | "ASSISTANT";
  content: string;
  payload: unknown;
}

const cut = (text: string, n = CHAT_HISTORY_CHARS) => (text.length > n ? `${text.slice(0, n)}…` : text);
const str = (x: unknown) => (typeof x === "string" ? x : "");
const lText = (x: unknown) => {
  const v = (x ?? {}) as { en?: unknown; ar?: unknown };
  return str(v.en) || str(v.ar);
};

/** What an answer drawn in the browser (post card, sample answer…) was, in one line for the AI. */
export function summarizeMessage(m: StoredChatMessage): string {
  if (m.content.trim()) return m.content.trim();
  const p = (m.payload ?? {}) as { kind?: unknown; text?: unknown; post?: { caption?: unknown; time?: unknown } };
  if (m.role === "USER") return lText(p.text);
  switch (p.kind) {
    case "text":
      return lText(p.text);
    case "post": {
      const caption = lText(p.post?.caption).replace(/\s+/g, " ");
      return `[Showed a post draft${caption ? `, caption: "${cut(caption, 200)}"` : ""}]`;
    }
    case "directions":
      return "[Showed a few post directions to choose from]";
    case "answer":
      return "[Showed a sample answer from the app's demo data]";
    case "pickInspiration":
      return "[Asked the owner to pick a competitor post as inspiration]";
    case "pickProduct":
      return "[Asked the owner to pick a product]";
    default:
      return "";
  }
}

/**
 * The chat's earlier turns for the model, oldest first: the last CHAT_HISTORY_LIMIT messages, each cut to
 * CHAT_HISTORY_CHARS, back-to-back messages of one side joined, starting with the owner and ending with an
 * answer (a question that never got one is left out). Read from the database, never from the browser.
 */
export function chatHistory(messages: StoredChatMessage[], limit = CHAT_HISTORY_LIMIT): Array<{ role: "user" | "model"; text: string }> {
  const turns: Array<{ role: "user" | "model"; text: string }> = [];
  for (const m of messages.slice(-limit)) {
    const text = neutralizeFacts(cut(summarizeMessage(m)), CHAT_HISTORY_CHARS);
    if (!text) continue;
    const role = m.role === "USER" ? "user" : "model";
    const last = turns.at(-1);
    if (last?.role === role) last.text = `${last.text}\n${text}`;
    else turns.push({ role, text });
  }
  while (turns[0]?.role === "model") turns.shift();
  while (turns.at(-1)?.role === "user") turns.pop();
  return turns;
}

// ─── Honesty: numbers ────────────────────────────────────────────────────────

/** A line's sentences (a decimal point isn't a sentence end). */
const sentencesOf = (line: string) => line.split(/(?<=[.!?؟])\s+/).filter((s) => s.trim());

export interface CheckedAnswer {
  /** The answer without the sentences that state a number not in the facts. */
  text: string;
  dropped: number;
  /** False when most of it is gone (or nothing is left): show the honest fallback instead. */
  usable: boolean;
}

/**
 * Every number the answer states must be in the facts (the Recommendations check: exact or rounded; times,
 * durations and small counts are fine). Sentences with an invented number are dropped; when more than half
 * of the sentences go, or nothing is left, the answer isn't usable.
 */
export function checkChatNumbers(answer: string, facts: string): CheckedAnswer {
  let total = 0;
  let dropped = 0;
  const lines: string[] = [];
  for (const line of answer.split("\n")) {
    const all = sentencesOf(line);
    if (!all.length) {
      lines.push("");
      continue;
    }
    const kept = all.filter((s) => tipUsesOnlyGivenNumbers(s, facts));
    total += all.length;
    dropped += all.length - kept.length;
    if (kept.length) lines.push(kept.join(" "));
  }
  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { text, dropped, usable: text.length > 0 && dropped * 2 <= total };
}
