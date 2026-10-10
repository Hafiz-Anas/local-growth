"use client";

import { useSyncExternalStore } from "react";
import { SIDEBAR_STORAGE_KEY as STORAGE_KEY } from "./sidebar-script";

/**
 * Sidebar collapse preference.
 *
 * The source of truth is `data-sidebar="collapsed"` on <html>: an inline script
 * sets it from localStorage before first paint, and all width / fade styling
 * reads it through the `sidebar-collapsed:` Tailwind variant, so there's no
 * flash or animation on load. React only reads it for tooltips and labels.
 */
const listeners = new Set<() => void>();

function isCollapsed() {
  return document.documentElement.dataset.sidebar === "collapsed";
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setSidebarCollapsed(collapsed: boolean) {
  if (collapsed) document.documentElement.dataset.sidebar = "collapsed";
  else delete document.documentElement.dataset.sidebar;
  try {
    localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
  } catch {
    // Storage unavailable (private mode, blocked site data): keep the in-page state only.
  }
  listeners.forEach((l) => l());
}

/** The user's saved preference (desktop). Defaults to expanded. */
export function useSidebarCollapsed() {
  return useSyncExternalStore(subscribe, isCollapsed, () => false);
}

/** True when the viewport matches `query`; false during SSR. */
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/**
 * Whether the sidebar is currently showing icons only — either the user
 * collapsed it, or the screen is tablet-sized (below 1280px auto-collapses).
 */
export function useSidebarIconOnly() {
  const collapsed = useSidebarCollapsed();
  const wide = useMediaQuery("(min-width: 1280px)");
  return collapsed || !wide;
}
