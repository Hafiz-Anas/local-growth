import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Inter } from "next/font/google";
import { AppProviders } from "@/components/providers/app-providers";
import { SIDEBAR_INIT_SCRIPT } from "@/lib/sidebar-script";
import { THEME_INIT_SCRIPT, normalizeTheme } from "@/lib/theme-script";
import { COOKIES, SITE } from "@/config/site";
import { directionOf } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: SITE.name, template: `%s · ${SITE.name}` },
  description: "AI-powered Instagram growth and management for local businesses — by Raid Technologies.",
};

export const viewport: Viewport = {
  // Dark by default (see lib/theme-script.ts).
  themeColor: "#000000",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  // Rendered on the server too, so even the HTML before any script runs has the right theme.
  const theme = normalizeTheme((await cookies()).get(COOKIES.theme)?.value);
  return (
    <html lang={locale} dir={directionOf(locale)} className={`${inter.variable} ${theme}`} style={{ colorScheme: theme }} suppressHydrationWarning>
      {/*
        Browser extensions add attributes to <head> and <body> before hydration (e.g. LocatorJS's
        data-locator-hook-status-message, ColorZilla's cz-shortcut-listen). This only silences
        attribute mismatches on these two elements, not in their children.
      */}
      <head suppressHydrationWarning>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: SIDEBAR_INIT_SCRIPT }} />
      </head>
      <body suppressHydrationWarning>
        <AppProviders locale={locale} theme={theme}>
          {children}
        </AppProviders>
      </body>
    </html>
  );
}
