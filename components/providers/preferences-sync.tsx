"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import { apiFetch } from "@/lib/api/client";
import { useMounted } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n/provider";
import { setSidebarCollapsed, useSidebarCollapsed } from "@/lib/sidebar";
import type { ThemePreference, UiPreferences } from "@/types";

/**
 * Keeps theme, language and sidebar state in the user's account.
 *  - Once after sign-in pages mount, the saved preferences are applied
 *    (before login the browser's own localStorage/cookie values are used).
 *  - After that, any change — from the top bar, the profile menu, Settings or
 *    the sidebar toggle — is saved to /api/me/preferences (debounced).
 * Renders nothing.
 */
export function PreferencesSync({ saved }: { saved: UiPreferences }) {
  const mounted = useMounted();
  const { theme, setTheme } = useTheme();
  const { locale, setLocale } = useI18n();
  const collapsed = useSidebarCollapsed();
  const applied = useRef(false);
  const lastSaved = useRef(saved);

  useEffect(() => {
    if (!mounted || applied.current) return;
    applied.current = true;
    if (saved.theme !== theme) setTheme(saved.theme);
    if (saved.sidebarCollapsed !== collapsed) setSidebarCollapsed(saved.sidebarCollapsed);
    if (saved.language !== locale) setLocale(saved.language);
  }, [mounted, saved, theme, collapsed, locale, setTheme, setLocale]);

  useEffect(() => {
    if (!applied.current || !theme) return;
    const current: UiPreferences = { theme: theme as ThemePreference, language: locale, sidebarCollapsed: collapsed };
    const patch = Object.fromEntries(
      (Object.keys(current) as Array<keyof UiPreferences>).filter((k) => current[k] !== lastSaved.current[k]).map((k) => [k, current[k]]),
    );
    if (Object.keys(patch).length === 0) return;
    // Debounced: the first pass right after applying the saved values is cancelled by the re-render it causes.
    const id = setTimeout(() => {
      lastSaved.current = { ...lastSaved.current, ...patch };
      apiFetch("/api/me/preferences", { method: "PATCH", body: patch }).catch(() => {
        // Not critical: the change still applies in this browser.
      });
    }, 600);
    return () => clearTimeout(id);
  }, [theme, locale, collapsed]);

  return null;
}
