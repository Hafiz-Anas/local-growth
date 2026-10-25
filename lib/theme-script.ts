import { COOKIES } from "@/config/site";

/** next-themes' localStorage key. */
export const THEME_STORAGE_KEY = "theme";

/**
 * Light is the default. Only an explicit "dark" (chosen in the profile menu or
 * Settings) stays dark; anything else — nothing saved, the old "system" value,
 * garbage — is light.
 */
export function normalizeTheme(value: unknown): "light" | "dark" {
  return value === "dark" ? "dark" : "light";
}

/**
 * Runs in <head> before first paint, ahead of next-themes' own script. Picks
 * the theme from the `lge_theme` cookie (set at login from the account's saved
 * preference, and on every toggle) or else localStorage, normalizes it, writes
 * it back to localStorage for next-themes and applies it to <html> right away,
 * so there is never a flash of the wrong theme.
 */
export const THEME_INIT_SCRIPT = `(function(){var t;try{var m=document.cookie.match(/(?:^|; )${COOKIES.theme}=(light|dark)/);t=m?m[1]:localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})}catch(e){}t=t==="dark"?"dark":"light";try{localStorage.setItem(${JSON.stringify(THEME_STORAGE_KEY)},t)}catch(e){}var d=document.documentElement;d.classList.remove("light","dark");d.classList.add(t);d.style.colorScheme=t})()`;
