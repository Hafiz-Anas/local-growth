import { BUSINESS_TYPES, type BusinessType } from "../../../config/onboarding";
import { TextGenerationError } from "./errors";
import { normalizeHashtag } from "./output";

/**
 * Onboarding's AI pre-fill, the pure parts: the hashtags the business already uses (read in
 * code, so they're there even without the AI), the answer's schema, and the parsing guards —
 * hashtags only from that list, products only when they're named in the bio or captions, and
 * menu categories as short generic labels (e.g. "Sweets", "Main dishes").
 * Pure (no server-only) so it can be unit-tested.
 */

export interface PrefillSuggestion {
  businessType: BusinessType | null;
  niche: string | null;
  toneLevel: number | null;
  hashtags: string[];
  products: string[];
  /** Short generic menu / product categories, e.g. "Sweets", "Main dishes". */
  categories: string[];
}

/** The hashtags in the bio and captions, most used first (spelling of the first use kept). */
export function extractHashtags(texts: string[], max = 10): string[] {
  const counts = new Map<string, { tag: string; count: number; first: number }>();
  let order = 0;
  for (const text of texts) {
    for (const raw of text.match(/#[\p{L}\p{N}_]+/gu) ?? []) {
      const tag = normalizeHashtag(raw);
      if (!tag) continue;
      const key = tag.toLowerCase();
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { tag, count: 1, first: order++ });
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.first - b.first)
    .slice(0, max)
    .map((e) => e.tag);
}

export const PREFILL_SCHEMA = {
  type: "OBJECT",
  properties: {
    business_type: { type: "STRING", enum: [...BUSINESS_TYPES], description: "The closest type; \"other\" if none fits." },
    niche: { type: "STRING", description: "The business's niche or theme in a few words, e.g. \"Specialty coffee roastery\". Empty if unclear." },
    tone_level: { type: "INTEGER", description: "0 = formal (Modern Standard Arabic, polished) … 50 = warm and friendly … 100 = casual (everyday Kuwaiti dialect, chatty)." },
    hashtags: { type: "ARRAY", items: { type: "STRING" }, description: "Up to 8 hashtags copied exactly from the candidate list; empty if none fit." },
    products: { type: "ARRAY", items: { type: "STRING" }, description: "Up to 5 products or services named in the bio or captions, as written there." },
    categories: { type: "ARRAY", items: { type: "STRING" }, description: 'Up to 5 short menu or product categories the posts show, e.g. "Sweets", "Main dishes", "Coffee".' },
  },
  required: ["business_type", "niche", "tone_level", "hashtags", "products", "categories"],
};

const fold = (s: string) => s.toLocaleLowerCase().replace(/\s+/g, " ").trim();

/** The model's JSON → suggestions that stay within what the account actually shows. */
export function parsePrefill(answer: string, guard: { candidates: string[]; sourceText: string }): PrefillSuggestion {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(answer.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as Record<string, unknown>;
  } catch {
    throw new TextGenerationError("bad_output", "The model's pre-fill wasn't valid JSON.", 200);
  }
  const type = typeof json.business_type === "string" && (BUSINESS_TYPES as readonly string[]).includes(json.business_type) ? (json.business_type as BusinessType) : null;
  const niche = typeof json.niche === "string" ? json.niche.replace(/\s+/g, " ").trim().slice(0, 80) : "";
  const tone = Number(json.tone_level);
  const allowed = new Map(guard.candidates.map((tag) => [tag.toLowerCase(), tag]));
  const hashtags = [
    ...new Set(
      (Array.isArray(json.hashtags) ? json.hashtags : [])
        .map((t) => (typeof t === "string" ? allowed.get(normalizeHashtag(t).toLowerCase()) : undefined))
        .filter((t): t is string => Boolean(t)),
    ),
  ].slice(0, 8);
  const source = fold(guard.sourceText);
  const products = [
    ...new Set(
      (Array.isArray(json.products) ? json.products : [])
        .filter((p): p is string => typeof p === "string")
        .map((p) => p.replace(/\s+/g, " ").trim().slice(0, 60))
        .filter((p) => p.length >= 2 && source.includes(fold(p))),
    ),
  ].slice(0, 5);
  const categories = [
    ...new Set(
      (Array.isArray(json.categories) ? json.categories : [])
        .filter((c): c is string => typeof c === "string")
        .map((c) => c.replace(/\s+/g, " ").replace(/^#+/, "").trim().slice(0, 40))
        // Labels, not sentences, prices or links.
        .filter((c) => c.length >= 2 && c.split(" ").length <= 4 && !/\d|https?:|www\./i.test(c)),
    ),
  ].slice(0, 5);
  return {
    businessType: type,
    niche: niche || null,
    toneLevel: Number.isFinite(tone) ? Math.max(0, Math.min(100, Math.round(tone))) : null,
    hashtags,
    products,
    categories,
  };
}
