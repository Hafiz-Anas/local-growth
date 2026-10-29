import { TextGenerationError } from "./errors";
import { normalizeHashtag, parseJsonAnswer } from "./output";
import { summaryUsesOnlyGivenNumbers } from "./report";

/**
 * Post captions for the owner's own photos (AI chat post card, BE2), the pure parts: the answer's schema,
 * the checks, and the neutral template used when the AI is unavailable. The model looks at the photo and
 * writes the caption in English and Arabic plus hashtags. An answer with a number that isn't in the
 * business data (no invented prices, counts or results) or a performance claim ("our best-selling",
 * "most loved") is rejected, and the template is used instead. Pure so it can be unit-tested.
 */

export const PHOTO_CAPTION_TONES = ["base", "shorter", "formal", "friendly"] as const;
export type PhotoCaptionTone = (typeof PHOTO_CAPTION_TONES)[number];

export const PHOTO_CAPTION_MAX = 600;
export const PHOTO_HASHTAGS_MAX = 8;

export const PHOTO_CAPTION_SCHEMA = {
  type: "OBJECT",
  properties: {
    caption_en: { type: "STRING", description: "The caption in English, without hashtags." },
    caption_ar: { type: "STRING", description: "The same caption in Arabic, without hashtags." },
    hashtags: { type: "ARRAY", items: { type: "STRING" }, description: "3 to 6 hashtags, each starting with #." },
  },
  required: ["caption_en", "caption_ar", "hashtags"],
};

export interface PhotoCaptionText {
  caption: { en: string; ar: string };
  hashtags: string[];
}

/** Claims about results or rank the business never gave us. */
const CLAIMS =
  /(best[- ]?sell|top[- ]?rated|most (popular|loved|liked|shared|ordered)|#1\b|number one|award[- ]?winning|everyone'?s favou?rite|sold out|الأكثر (مبيع|طلب|شعبية)|الأفضل في|رقم (1|١|واحد) في|الكل يحب)/i;

const bad = (why: string) => new TextGenerationError("bad_output", why, 200);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function tidy(text: string): { text: string; tags: string[] } {
  const tags = [...text.matchAll(/#[\p{L}\p{N}_]+/gu)].map((m) => m[0]);
  const clean = text
    .replace(/#[\p{L}\p{N}_]+/gu, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([,.!?،؟])/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text: clean, tags };
}

/** Whether a caption is safe to show: only numbers from the business data, no performance claims. */
export function captionIsGrounded(text: string, data: string): boolean {
  return !CLAIMS.test(text) && summaryUsesOnlyGivenNumbers(text, data);
}

/** The model's answer, checked against `data` (everything the prompt told it about the business and the request). */
export function parsePhotoCaption(answer: string, data: string): PhotoCaptionText {
  const json = parseJsonAnswer(answer, "photo caption");
  if (!json || typeof json !== "object") throw bad("The caption wasn't an object.");
  const record = json as Record<string, unknown>;
  const en = tidy(str(record.caption_en));
  const ar = tidy(str(record.caption_ar));
  if (!en.text || !ar.text) throw bad("The answer has no caption.");
  if (en.text.length > PHOTO_CAPTION_MAX || ar.text.length > PHOTO_CAPTION_MAX) throw bad("The caption is too long.");
  if (!captionIsGrounded(en.text, data) || !captionIsGrounded(ar.text, data)) throw bad("The caption states a number or claim that isn't in the data.");
  const raw = [...(Array.isArray(record.hashtags) ? record.hashtags.filter((t): t is string => typeof t === "string") : []), ...en.tags, ...ar.tags];
  const hashtags = [...new Set(raw.map(normalizeHashtag).filter(Boolean))].filter((t) => !/\d/.test(t) || data.includes(t.slice(1))).slice(0, PHOTO_HASHTAGS_MAX);
  if (!hashtags.length) throw bad("The answer has no hashtags.");
  return { caption: { en: en.text, ar: ar.text }, hashtags };
}

/** A hashtag from a name: letters and digits only ("Fereej Bakery" → "#FereejBakery"), or "" when nothing is left. */
export function nameTag(name: string): string {
  const tag = name.normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, "");
  return tag.length >= 2 ? `#${tag.slice(0, 40)}` : "";
}

export interface NeutralCaptionInput {
  businessName: string;
  businessNameAr: string | null;
  /** The business's own hashtags (Brand voice), if any. */
  defaultHashtags: string[];
  /** "Salmiya", or null. */
  area: string | null;
  areaAr: string | null;
}

/**
 * The caption when the AI is unavailable: about the business only (never a sample dish, never a claim),
 * so it fits any photo. The owner edits it before posting.
 */
export function neutralCaption(input: NeutralCaptionInput, tone: PhotoCaptionTone = "base"): PhotoCaptionText {
  const name = input.businessName;
  const nameAr = input.businessNameAr || input.businessName;
  const where = input.area ? ` in ${input.area}` : "";
  const whereAr = input.areaAr ? ` في ${input.areaAr}` : "";
  const en =
    tone === "shorter"
      ? `Fresh from ${name}. Message us to order.`
      : tone === "formal"
        ? `${name} is pleased to share this with you. Send us a message for orders and details${where ? `, or visit us${where}` : ""}.`
        : tone === "friendly"
          ? `Look what we've got for you today ✨ Send us a message and we'll get yours ready${where ? `, or drop by${where}` : ""}!`
          : `Something new from ${name}. Send us a message to order${where ? ` or visit us${where}` : ""}.`;
  const ar =
    tone === "shorter"
      ? `جديد من ${nameAr}. راسلونا للطلب.`
      : tone === "formal"
        ? `يسعد ${nameAr} مشاركتكم هذا. تواصلوا معنا للطلب والتفاصيل${whereAr ? ` أو تفضلوا بزيارتنا${whereAr}` : ""}.`
        : tone === "friendly"
          ? `شوفوا شنو جهزنا لكم اليوم ✨ راسلونا ونجهز طلبكم${whereAr ? ` أو مرّوا علينا${whereAr}` : ""}!`
          : `جديد من ${nameAr}. راسلونا للطلب${whereAr ? ` أو زورونا${whereAr}` : ""}.`;
  const tags = [...input.defaultHashtags.map(normalizeHashtag).filter(Boolean), nameTag(name)].filter(Boolean);
  return { caption: { en, ar }, hashtags: [...new Set(tags)].slice(0, PHOTO_HASHTAGS_MAX) };
}
