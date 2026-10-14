import { POST_PURPOSES, type PostPurpose } from "../../../config/onboarding";
import type { CaptionStyle, PurposePattern, StyleNotes } from "../../../types";
import { TextGenerationError } from "./errors";

/**
 * Turns the model's answers into what the app stores, and the small helpers
 * the mock shares (language detection, greeting name, words to avoid).
 * Anything malformed is a "bad_output" TextGenerationError, so the AI service
 * falls back to the template text. Pure (no server-only) so it can be unit-tested.
 */

export const isArabic = (text: string) => /[؀-ۿ]/.test(text);

/** The reply language follows the customer: any Arabic letter → Arabic. */
export const replyLanguage = (customerText: string): "en" | "ar" => (isArabic(customerText) ? "ar" : "en");

/** "sara.k_88" → "Sara": the part of the username replies greet by, capitalized ("" when unknown; Arabic names stay as written). */
export const greetName = (username: string) => {
  const name = username.split(/[._]/)[0] ?? "";
  return name.charAt(0).toLocaleUpperCase("en") + name.slice(1);
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Removes words the brand asked to avoid, then tidies the spacing left behind. */
export function stripAvoided(text: string, avoid: string[]): string {
  let out = text;
  for (const word of avoid) {
    if (word.trim()) out = out.replace(new RegExp(escapeRegExp(word.trim()), "giu"), "");
  }
  return out.replace(/[ \t]{2,}/g, " ").replace(/ +([,.!?،])/g, "$1").trim();
}

const bad = (what: string) => new TextGenerationError("bad_output", `The model's ${what} wasn't in the expected format.`, 200);

/** JSON from a structured answer (tolerates a ```json fence). */
export function parseJsonAnswer(text: string, what: string): unknown {
  const body = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(body);
  } catch {
    throw bad(what);
  }
}

const isString = (v: unknown): v is string => typeof v === "string";
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter(isString).map((s) => s.trim()).filter(Boolean) : []);

/** "#Kuwait Coffee" → "#KuwaitCoffee"; "" when nothing is left. */
export function normalizeHashtag(tag: string): string {
  const body = tag.replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "");
  return body ? `#${body}` : "";
}

export interface ModelCaption {
  text: string;
  hashtags: string[];
}

export function parseCaptions(answer: string): ModelCaption[] {
  const json = parseJsonAnswer(answer, "captions") as { captions?: unknown };
  if (!Array.isArray(json?.captions)) throw bad("captions");
  const captions = json.captions
    .map((c: { text?: unknown; hashtags?: unknown }) => ({
      // Hashtags belong in their own field; drop any the model left in the body.
      text: isString(c?.text) ? c.text.replace(/(^|\s)#[\p{L}\p{N}_]+/gu, "").trim() : "",
      hashtags: strings(c?.hashtags).map(normalizeHashtag).filter(Boolean),
    }))
    .filter((c) => c.text);
  if (!captions.length) throw bad("captions");
  return captions;
}

/**
 * Caption body + hashtags, without the words to avoid. Same layout as the mock.
 * The model may only pick from the brand's `allowed` hashtags (anything else is
 * dropped, written the brand's way); the business's `always` tags follow.
 */
export function composeCaption(caption: ModelCaption, allowed: string[], always: string[], avoid: string[]): { caption: string; language: "en" | "ar" } {
  const brand = new Map([...allowed, ...always].map(normalizeHashtag).filter(Boolean).map((tag) => [tag.toLowerCase(), tag]));
  const picked = caption.hashtags.map((tag) => brand.get(tag.toLowerCase())).filter((tag): tag is string => Boolean(tag));
  const tags = [...new Set([...picked, ...always.map(normalizeHashtag).filter(Boolean)])].slice(0, 8).join(" ");
  return { caption: stripAvoided(tags ? `${caption.text}\n\n${tags}` : caption.text, avoid), language: replyLanguage(caption.text) };
}

/** A plain-text reply, without wrapping quotes or hashtags. */
export function cleanReply(answer: string): string {
  const text = answer
    .trim()
    .replace(/^(["“«'])([\s\S]*)(["”»'])$/u, "$2")
    .replace(/(^|\s)#[\p{L}\p{N}_]+/gu, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  if (!text) throw bad("reply");
  return text;
}

export interface ParsedBrandContext {
  summary: string;
  visualStyle: StyleNotes;
  captionStyle: CaptionStyle;
  purposePatterns: PurposePattern[];
}

function styleNotes(v: unknown): StyleNotes | null {
  const o = v as { summary?: unknown; traits?: unknown } | null;
  return o && isString(o.summary) && o.summary.trim() ? { summary: o.summary.trim(), traits: strings(o.traits).slice(0, 8) } : null;
}

export function parseBrandContext(answer: string): ParsedBrandContext {
  const json = parseJsonAnswer(answer, "brand profile") as Record<string, unknown> | null;
  const summary = isString(json?.summary) ? json.summary.trim() : "";
  const visualStyle = styleNotes(json?.visualStyle);
  const caption = styleNotes(json?.captionStyle);
  if (!summary || !visualStyle || !caption) throw bad("brand profile");
  const hashtags = strings((json?.captionStyle as { hashtags?: unknown }).hashtags).map(normalizeHashtag).filter(Boolean);

  const seen = new Set<string>();
  const purposePatterns: PurposePattern[] = [];
  for (const p of Array.isArray(json?.purposePatterns) ? json.purposePatterns : []) {
    const purpose = (p as { purpose?: unknown })?.purpose;
    const description = (p as { description?: unknown })?.description;
    if (!isString(purpose) || !(POST_PURPOSES as readonly string[]).includes(purpose) || !isString(description) || !description.trim()) continue;
    const rawLabel = (p as { label?: unknown }).label;
    const label = purpose === "other" && isString(rawLabel) && rawLabel.trim() ? rawLabel.trim() : null;
    const key = purpose === "other" ? `other:${label ?? ""}` : purpose;
    if (seen.has(key)) continue;
    seen.add(key);
    purposePatterns.push({ purpose: purpose as PostPurpose, label, description: description.trim() });
  }

  return { summary, visualStyle, captionStyle: { ...caption, hashtags: [...new Set(hashtags)].slice(0, 8) }, purposePatterns };
}
