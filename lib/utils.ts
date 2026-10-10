import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";
import { SITE, type Locale } from "@/config/site";

// Teach tailwind-merge the custom tokens from globals.css, otherwise e.g.
// `text-body` (a font size) would be treated as a colour and drop `text-primary`.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["caption", "body", "title", "heading", "display"] }],
      rounded: [{ rounded: ["button", "card", "panel", "pill"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Intl locale tag. Arabic keeps Latin digits, matching Instagram's Arabic UI. */
export function intlLocale(locale: Locale) {
  return locale === "ar" ? "ar-KW-u-nu-latn" : "en-US";
}

/** Instagram-style compact counts: 18.4K, 1.2M. */
export function formatCompact(value: number, locale: Locale = "en") {
  return new Intl.NumberFormat(intlLocale(locale), {
    notation: value >= 10000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatNumber(value: number, locale: Locale = "en") {
  return new Intl.NumberFormat(intlLocale(locale)).format(value);
}

export function formatPct(value: number, { signed = false } = {}) {
  const rounded = Math.round(value * 10) / 10;
  const sign = signed && rounded > 0 ? "+" : "";
  return `${sign}${rounded}%`;
}

/** Date/time rendered in Kuwait time regardless of the viewer's machine zone. */
export function formatDateTime(iso: string, locale: Locale, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(intlLocale(locale), { timeZone: SITE.timeZone, ...options }).format(new Date(iso));
}

/** Instagram-style short relative time: 5m, 3h, 2d, 1w. */
export function timeAgo(iso: string, locale: Locale, now: number = Date.now()) {
  const minutes = Math.max(1, Math.round((now - new Date(iso).getTime()) / 60000));
  const units: Array<[number, string, string]> = [
    [60 * 24 * 7, "w", "أ"],
    [60 * 24, "d", "ي"],
    [60, "h", "س"],
    [1, "m", "د"],
  ];
  for (const [size, en, ar] of units) {
    if (minutes >= size) {
      const n = Math.floor(minutes / size);
      return locale === "ar" ? `${n} ${ar}` : `${n}${en}`;
    }
  }
  return locale === "ar" ? "الآن" : "now";
}

export function hourLabel(hour: number, locale: Locale) {
  const date = new Date(Date.UTC(2026, 0, 1, hour));
  return new Intl.DateTimeFormat(intlLocale(locale), { hour: "numeric", timeZone: "UTC" }).format(date);
}

export function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Up to two initials from a name ("Dalla & Bean" → "DB"), for avatar fallbacks. */
export function initials(name: string) {
  const words = name.split(/\s+/).filter((w) => /\p{L}/u.test(w));
  return words.slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
}

const AVATAR_TONES = ["roast", "pistachio", "date", "rose", "latte", "sand", "night", "berry"] as const;

/** Stable fallback colour for an avatar without a photo, derived from any id or handle. */
export function toneFor(seed: string): (typeof AVATAR_TONES)[number] {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}
