"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { ThemeProvider, useTheme } from "next-themes";
import { COOKIES, type Locale } from "@/config/site";
import { normalizeTheme } from "@/lib/theme-script";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/lib/i18n/provider";
import { Feedback } from "./feedback";
import { QueryProvider } from "./query-provider";

export function AppProviders({ locale, theme, children }: { locale: Locale; theme: "light" | "dark"; children: ReactNode }) {
  return (
    // Dark unless the person chose light; no "system" mode. lib/theme-script.ts applies it before first paint.
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
      <ThemeSync serverTheme={theme} />
      <I18nProvider initialLocale={locale}>
        <QueryProvider>
          <TooltipProvider>
            {children}
            <Feedback />
          </TooltipProvider>
        </QueryProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}

/**
 * Keeps the lge_theme cookie and the page in step:
 *  - every theme change is mirrored into the cookie, so the server and the
 *    pre-paint script agree on the next load;
 *  - when the server's value changes without a page load (the login action sets
 *    the cookie from the account's saved theme, then redirects client-side), it
 *    is applied before paint instead of waiting for PreferencesSync.
 */
function ThemeSync({ serverTheme }: { serverTheme: "light" | "dark" }) {
  const { theme, setTheme } = useTheme();
  const lastServerTheme = useRef(serverTheme);
  useLayoutEffect(() => {
    if (serverTheme === lastServerTheme.current) return;
    lastServerTheme.current = serverTheme;
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(serverTheme);
    root.style.colorScheme = serverTheme;
    setTheme(serverTheme);
  }, [serverTheme, setTheme]);
  useEffect(() => {
    if (!theme) return;
    document.cookie = `${COOKIES.theme}=${normalizeTheme(theme)}; path=/; max-age=31536000; samesite=lax`;
  }, [theme]);
  return null;
}
