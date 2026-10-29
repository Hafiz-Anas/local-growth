import type { CaptionVersionDto } from "@/types/api";
import { GALLERY_CAPTION_VERSIONS } from "./uploads";

/**
 * Gallery / AI chat drafts, the pure parts (lib/server/gallery-drafts.ts stores them): caption versions
 * kept by Regenerate, and the one-language caption the old PostDraft columns hold. Pure so the tests import it.
 */

type Both = { en: string; ar: string };

/** Stored versions (PostDraft.captionVersions), dropping anything malformed. */
export function parseVersions(stored: unknown): CaptionVersionDto[] {
  if (!Array.isArray(stored)) return [];
  return stored
    .filter((v): v is CaptionVersionDto => !!v && typeof v === "object" && typeof v.en === "string" && typeof v.ar === "string" && typeof v.at === "string")
    .slice(0, GALLERY_CAPTION_VERSIONS);
}

const sameCaption = (a: Both, b: Both) => a.en.trim() === b.en.trim() && a.ar.trim() === b.ar.trim();

/**
 * The versions after the caption changed from `previous`: it goes first (newest first), unless it's empty,
 * the same as the new caption or already the newest version; at most GALLERY_CAPTION_VERSIONS are kept.
 */
export function withVersion(versions: CaptionVersionDto[], previous: Both, next: Both, at: string): CaptionVersionDto[] {
  if ((!previous.en.trim() && !previous.ar.trim()) || sameCaption(previous, next) || (versions[0] && sameCaption(versions[0], previous))) return versions;
  return [{ en: previous.en, ar: previous.ar, at }, ...versions].slice(0, GALLERY_CAPTION_VERSIONS);
}

/** Merges versions the AI chat kept before the draft was saved (newest first), without duplicates. */
export function mergeVersions(versions: CaptionVersionDto[], earlier: CaptionVersionDto[]): CaptionVersionDto[] {
  const out: CaptionVersionDto[] = [];
  for (const v of [...versions, ...earlier]) if (!out.some((o) => sameCaption(o, v))) out.push(v);
  return out.slice(0, GALLERY_CAPTION_VERSIONS);
}

/** The caption the old single-language columns (PostDraft.caption + language) hold: Arabic when there is one. */
export function primaryCaption(caption: Both): { caption: string; language: "ar" | "en" } {
  return caption.ar.trim() ? { caption: caption.ar, language: "ar" } : { caption: caption.en, language: "en" };
}

/** Hashtags in a caption as written (#tag), in order, without duplicates. */
export function hashtagsIn(...texts: string[]): string[] {
  const tags = texts.flatMap((text) => [...text.matchAll(/#[\p{L}\p{N}_]+/gu)].map((m) => m[0]));
  return [...new Set(tags)].slice(0, 30);
}

/** Caption text plus hashtags, as posted (the AI chat's fullCaption). */
export function withHashtags(text: string, hashtags: string[]): string {
  const missing = hashtags.filter((tag) => !text.includes(tag));
  return `${text}${missing.length ? `\n\n${missing.join(" ")}` : ""}`.trim();
}
