import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { AppProviders } from "@/components/providers/app-providers";
import { SIDEBAR_INIT_SCRIPT } from "@/lib/sidebar-script";
import { SITE } from "@/config/site";
import { directionOf } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: SITE.name, template: `%s · ${SITE.name}` },
  description: "AI-powered Instagram growth and management for local businesses — by Raid Technologies.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  return (
    <html lang={locale} dir={directionOf(locale)} className={inter.variable} suppressHydrationWarning>
      {/*
        Browser extensions add attributes to <head> and <body> before hydration (e.g. LocatorJS's
        data-locator-hook-status-message, ColorZilla's cz-shortcut-listen). This only silences
        attribute mismatches on these two elements, not in their children.
      */}
      <head suppressHydrationWarning>
        <script dangerouslySetInnerHTML={{ __html: SIDEBAR_INIT_SCRIPT }} />
      </head>
      <body suppressHydrationWarning>
        <AppProviders locale={locale}>{children}</AppProviders>
      </body>
    </html>
  );
}
