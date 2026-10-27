import ar from "@/locales/ar.json";
import en from "@/locales/en.json";
import type { Lang } from "@/mock-data/gallery/types";

/*
 * The Gallery and AI chat wording (from the design proposal) lives in locales/*.json under
 * `galleryAi`. These helpers keep the proposal's flat keys: t("library"), translate("ar", "photoPrompt").
 */
export type MessageKey = keyof typeof en.galleryAi;

const dictionaries: Record<Lang, Record<string, string>> = { en: en.galleryAi, ar: ar.galleryAi };

export function translate(lang: Lang, key: MessageKey, vars?: Record<string, string | number>) {
  let s = dictionaries[lang][key] ?? dictionaries.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}
