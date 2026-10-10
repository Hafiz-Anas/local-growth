"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Direction } from "radix-ui";
import { COOKIES, type Locale } from "@/config/site";
import { directionOf, translate, translateList, type TranslateVars } from "./index";

interface I18nContextValue {
  locale: Locale;
  dir: "ltr" | "rtl";
  t: (key: string, vars?: TranslateVars) => string;
  tList: (key: string) => string[];
  setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ initialLocale, children }: { initialLocale: Locale; children: ReactNode }) {
  const router = useRouter();
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const dir = directionOf(locale);

  const setLocale = useCallback(
    (next: Locale) => {
      document.cookie = `${COOKIES.locale}=${next}; path=/; max-age=31536000; samesite=lax`;
      document.documentElement.lang = next;
      document.documentElement.dir = directionOf(next);
      setLocaleState(next);
      router.refresh();
    },
    [router],
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      dir,
      t: (key, vars) => translate(locale, key, vars),
      tList: (key) => translateList(locale, key),
      setLocale,
    }),
    [locale, dir, setLocale],
  );

  return (
    <I18nContext.Provider value={value}>
      <Direction.Provider dir={dir}>{children}</Direction.Provider>
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>");
  return ctx;
}
