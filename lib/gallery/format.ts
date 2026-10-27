import { NOW, TIME_ZONE } from "@/mock-data/gallery/clock";
import type { L, Lang } from "@/mock-data/gallery/types";

const locale = (lang: Lang) => (lang === "ar" ? "ar-KW-u-nu-arab" : "en-GB");

export const tr = (text: L | undefined, lang: Lang) => (text ? text[lang] : "");

export function num(n: number, lang: Lang, digits = 0) {
  return new Intl.NumberFormat(locale(lang), { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
}

/** 12.4K style, like Instagram. */
export function compact(n: number, lang: Lang) {
  return new Intl.NumberFormat(timeLocale(lang), { notation: "compact", maximumFractionDigits: n < 100_000 ? 1 : 0 }).format(n);
}

export function pct(n: number, lang: Lang, digits = 1) {
  return `${num(n, lang, digits)}${lang === "ar" ? "٪" : "%"}`;
}

export function signed(n: number, lang: Lang, digits = 1, unit: "%" | "pt" = "%") {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  const value = num(Math.abs(n), lang, digits);
  const suffix = unit === "%" ? (lang === "ar" ? "٪" : "%") : lang === "ar" ? " نقطة" : " pt";
  return `${sign}${value}${suffix}`;
}

const timeLocale = (lang: Lang) => (lang === "ar" ? "ar-KW-u-nu-arab" : "en-US");

export function time(iso: string, lang: Lang) {
  return new Intl.DateTimeFormat(timeLocale(lang), { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));
}

export function hourLabel(hour: number, lang: Lang) {
  const d = new Date(`2026-10-16T${String(hour % 24).padStart(2, "0")}:00:00+03:00`);
  return new Intl.DateTimeFormat(timeLocale(lang), { timeZone: TIME_ZONE, hour: "numeric", hour12: true }).format(d);
}

export function date(iso: string, lang: Lang, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) {
  return new Intl.DateTimeFormat(locale(lang), { timeZone: TIME_ZONE, ...opts }).format(new Date(iso));
}

export function weekday(iso: string, lang: Lang, style: "short" | "long" = "short") {
  return new Intl.DateTimeFormat(locale(lang), { timeZone: TIME_ZONE, weekday: style }).format(new Date(iso));
}

/** Kuwait calendar day key, e.g. 2026-10-16. */
export function dayKey(iso: string) {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: TIME_ZONE });
}

export function daysFromNow(iso: string) {
  const a = new Date(dayKey(NOW.toISOString())).getTime();
  const b = new Date(dayKey(iso)).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** "Today", "Yesterday", "Wed 14 Oct", like the Photos app. */
export function dayHeading(iso: string, lang: Lang) {
  const diff = daysFromNow(iso);
  if (diff === 0) return lang === "ar" ? "اليوم" : "Today";
  if (diff === -1) return lang === "ar" ? "أمس" : "Yesterday";
  if (diff > -7) return weekday(iso, lang, "long");
  return date(iso, lang, { weekday: "short", day: "numeric", month: "short" });
}

/** "Tomorrow, 8:30 PM" / "Sun 18 Oct, 1:00 PM". */
export function when(iso: string, lang: Lang) {
  const diff = daysFromNow(iso);
  const t = time(iso, lang);
  if (diff === 0) return lang === "ar" ? `اليوم، ${t}` : `Today, ${t}`;
  if (diff === 1) return lang === "ar" ? `غداً، ${t}` : `Tomorrow, ${t}`;
  if (diff === -1) return lang === "ar" ? `أمس، ${t}` : `Yesterday, ${t}`;
  return `${date(iso, lang, { weekday: "short", day: "numeric", month: "short" })}${lang === "ar" ? "، " : ", "}${t}`;
}

/** Instagram-style short relative time: 5m, 2h, 3d, 2w. */
export function ago(iso: string, lang: Lang) {
  const mins = Math.max(0, Math.round((NOW.getTime() - new Date(iso).getTime()) / 60_000));
  const ar = lang === "ar";
  if (mins < 1) return ar ? "الآن" : "now";
  if (mins < 60) return ar ? `${num(mins, lang)} د` : `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return ar ? `${num(h, lang)} س` : `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return ar ? `${num(d, lang)} ي` : `${d}d`;
  const w = Math.floor(d / 7);
  return ar ? `${num(w, lang)} أ` : `${w}w`;
}
