import { TextGenerationError } from "./errors";
import { normalizeHashtag, parseJsonAnswer } from "./output";

/**
 * "Create a similar post" (AI chat, from a competitor's post in the viewer), the pure parts: the
 * answer's schema and the parser. The model explains what makes the competitor's post work (topic,
 * style, hook) and writes a new post in that style for the business, in English and Arabic. The
 * competitor's image is never sent and never reused; a caption that copies their wording (a run of
 * COPY_RUN words in a row) or names their account is rejected, and the chat then shows its sample
 * answer instead. Pure (no server-only) so it can be unit-tested.
 */

/** This many words in a row taken from the competitor's caption counts as copying. */
export const COPY_RUN = 5;
export const SIMILAR_CAPTION_MAX = 600;
export const SIMILAR_HASHTAGS_MAX = 8;
const NOTE_MAX = 200;

export const SIMILAR_POST_SCHEMA = {
  type: "OBJECT",
  properties: {
    topic_en: { type: "STRING", description: "What the competitor's post is about, one short sentence." },
    topic_ar: { type: "STRING" },
    style_en: { type: "STRING", description: "How it is written and shown (format, tone, layout), one short sentence." },
    style_ar: { type: "STRING" },
    hook_en: { type: "STRING", description: "What makes people stop and react, one short sentence." },
    hook_ar: { type: "STRING" },
    caption_en: { type: "STRING", description: "The new caption for the business in English, without hashtags." },
    caption_ar: { type: "STRING", description: "The same caption in Arabic, without hashtags." },
    hashtags: { type: "ARRAY", items: { type: "STRING" }, description: "3 to 6 hashtags for the business's post." },
  },
  required: ["topic_en", "topic_ar", "style_en", "style_ar", "hook_en", "hook_ar", "caption_en", "caption_ar", "hashtags"],
};

type Both = { en: string; ar: string };

export interface SimilarPostText {
  topic: Both;
  style: Both;
  hook: Both;
  caption: Both;
  hashtags: string[];
}

/** Lowercased words (letters and digits only, any script), for comparing captions. */
const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/#[\p{L}\p{N}_]+/gu, " ")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/**
 * Whether `candidate` repeats COPY_RUN or more words in a row from `source` (hashtags aside). A shorter
 * caption (3+ words) counts as copied when all of it appears in a row.
 */
export function copiesCaption(candidate: string, source: string, minRun = COPY_RUN): boolean {
  const from = words(source);
  const run = Math.min(minRun, from.length);
  if (run < 3) return false;
  const runs = new Set<string>();
  for (let i = 0; i + run <= from.length; i++) runs.add(from.slice(i, i + run).join(" "));
  const to = words(candidate);
  for (let i = 0; i + run <= to.length; i++) if (runs.has(to.slice(i, i + run).join(" "))) return true;
  return false;
}

const bad = (why: string) => new TextGenerationError("bad_output", why, 200);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Caption text without trailing or inline hashtags (they go in `hashtags`), tidied. */
function captionText(text: string): { text: string; tags: string[] } {
  const tags = [...text.matchAll(/#[\p{L}\p{N}_]+/gu)].map((m) => m[0]);
  const clean = text
    .replace(/#[\p{L}\p{N}_]+/gu, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text: clean, tags };
}

const note = (json: Record<string, unknown>, key: string) => {
  const en = str(json[`${key}_en`]).slice(0, NOTE_MAX);
  const ar = str(json[`${key}_ar`]).slice(0, NOTE_MAX);
  if (!en || !ar) throw bad(`The answer has no ${key}.`);
  return { en, ar };
};

/**
 * The model's answer, checked: every field present, captions without hashtags and within length,
 * nothing copied from the competitor's caption, their handle never mentioned.
 */
export function parseSimilarPost(answer: string, source: { caption: string; handle: string }): SimilarPostText {
  const json = parseJsonAnswer(answer, "similar post");
  if (!json || typeof json !== "object") throw bad("The similar post wasn't an object.");
  const data = json as Record<string, unknown>;
  const en = captionText(str(data.caption_en));
  const ar = captionText(str(data.caption_ar));
  if (!en.text || !ar.text) throw bad("The similar post has no caption.");
  if (en.text.length > SIMILAR_CAPTION_MAX || ar.text.length > SIMILAR_CAPTION_MAX) throw bad("The similar post's caption is too long.");

  const handle = source.handle.toLowerCase().replace(/^@/, "");
  for (const text of [en.text, ar.text]) {
    if (handle && text.toLowerCase().includes(handle)) throw bad("The caption names the competitor.");
    if (copiesCaption(text, source.caption)) throw bad("The caption copies the competitor's wording.");
  }

  const raw = [...(Array.isArray(data.hashtags) ? data.hashtags.filter((t): t is string => typeof t === "string") : []), ...en.tags, ...ar.tags];
  // Their brand tag (#brewlanekw for @brew_lane_kw) never goes on the business's post.
  const brand = handle.replace(/[._]/g, "");
  const hashtags = [...new Set(raw.map(normalizeHashtag).filter((t) => t && (!brand || !t.toLowerCase().includes(brand))))].slice(0, SIMILAR_HASHTAGS_MAX);
  if (!hashtags.length) throw bad("The similar post has no hashtags.");

  return { topic: note(data, "topic"), style: note(data, "style"), hook: note(data, "hook"), caption: { en: en.text, ar: ar.text }, hashtags };
}
