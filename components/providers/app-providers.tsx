"use client";

import type { ReactNode } from "react";
import { ThemeProvider } from "next-themes";
import type { Locale } from "@/config/site";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/lib/i18n/provider";
import { Feedback } from "./feedback";
import { QueryProvider } from "./query-provider";

export function AppProviders({ locale, children }: { locale: Locale; children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
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
