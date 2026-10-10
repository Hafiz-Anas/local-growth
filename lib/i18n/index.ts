import ar from "@/locales/ar.json";
import en from "@/locales/en.json";
import type { Locale } from "@/config/site";

export type Messages = typeof en;

export const dictionaries: Record<Locale, Messages> = { en, ar };

export function directionOf(locale: Locale): "ltr" | "rtl" {
  return locale === "ar" ? "rtl" : "ltr";
}

export type TranslateVars = Record<string, string | number>;

/** Looks up a dot-path ("dashboard.metrics.reach") and fills {placeholders}. Falls back to English, then the key. */
export function translate(locale: Locale, key: string, vars?: TranslateVars): string {
  const raw = lookup(dictionaries[locale], key) ?? lookup(dictionaries.en, key);
  if (typeof raw !== "string") return key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, name: string) => (name in vars ? String(vars[name]) : `{${name}}`));
}

/** Returns a non-string node (e.g. an array like `experiment.days`). */
export function translateList(locale: Locale, key: string): string[] {
  const raw = lookup(dictionaries[locale], key) ?? lookup(dictionaries.en, key);
  return Array.isArray(raw) ? (raw as string[]) : [];
}

function lookup(messages: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => {
    if (node && typeof node === "object" && part in node) return (node as Record<string, unknown>)[part];
    return undefined;
  }, messages);
}
