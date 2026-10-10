import type { InstagramLanguage } from "@/config/onboarding";

/**
 * Learns which language(s) a brand posts in from its captions, so onboarding
 * doesn't have to ask. Pure (no db) so it can be unit-tested.
 */

const ARABIC_LETTER = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/gu;
const LATIN_LETTER = /[A-Za-zÀ-ɏ]/gu;
/** Hashtags, mentions and links are often English even in Arabic captions. */
const NOISE = /(?:#|@)[\p{L}\p{N}_.]+|https?:\/\/\S+|www\.\S+/gu;

/** A language is kept when at least this share of the captions use it. */
const MIN_SHARE = 0.25;
/** Letters a caption needs before it counts (skips emoji-only or one-word captions). */
const MIN_LETTERS = 4;

/** "ar", "en" or "both" for one caption; null when it has too little text to tell. */
export function captionLanguage(caption: string): InstagramLanguage | "both" | null {
  const text = caption.replace(NOISE, " ");
  const arabic = text.match(ARABIC_LETTER)?.length ?? 0;
  const latin = text.match(LATIN_LETTER)?.length ?? 0;
  if (arabic + latin < MIN_LETTERS) return null;
  const share = arabic / (arabic + latin);
  return share >= 0.7 ? "ar" : share <= 0.3 ? "en" : "both";
}

/**
 * Posting language(s) across captions: each language used in at least a
 * quarter of them. Null when no caption has enough text (keep what is saved).
 */
export function inferPostingLanguages(captions: string[]): InstagramLanguage[] | null {
  const kinds = captions.map(captionLanguage).filter((k) => k !== null);
  if (kinds.length === 0) return null;
  const share = (lang: InstagramLanguage) => kinds.filter((k) => k === lang || k === "both").length / kinds.length;
  const languages = (["ar", "en"] as const).filter((lang) => share(lang) >= MIN_SHARE);
  return languages.length ? languages : null;
}
