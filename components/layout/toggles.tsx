"use client";

import { Languages, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { useMounted } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n/provider";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const { t } = useI18n();
  const mounted = useMounted();
  const dark = mounted && resolvedTheme === "dark";
  const label = dark ? t("topbar.switchToLight") : t("topbar.switchToDark");
  return (
    <Button variant="ghost" size="icon" aria-label={label} title={label} onClick={() => setTheme(dark ? "light" : "dark")}>
      {dark ? <Sun strokeWidth={1.75} /> : <Moon strokeWidth={1.75} />}
    </Button>
  );
}

export function LanguageToggle({ compact = false }: { compact?: boolean }) {
  const { t, locale, setLocale } = useI18n();
  return (
    <Button
      variant="ghost"
      size={compact ? "icon" : "sm"}
      onClick={() => setLocale(locale === "en" ? "ar" : "en")}
      aria-label={t("topbar.languageLabel")}
      title={t("topbar.languageLabel")}
      className={compact ? undefined : "px-2.5"}
    >
      <Languages className="size-5" strokeWidth={1.75} />
      {!compact && <span>{t("topbar.language")}</span>}
    </Button>
  );
}
