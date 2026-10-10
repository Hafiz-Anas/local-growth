export const SITE = {
  name: "Local Growth Engine",
  company: "Raid Technologies",
  timeZone: "Asia/Kuwait",
  defaultLocale: "en",
} as const;

/** Cookie names shared by the proxy, server code and client toggles. (The session cookie is managed by Auth.js.) */
export const COOKIES = {
  /** Admin-only: id of the client being previewed on user routes. */
  preview: "lge_preview",
  locale: "lge_locale",
} as const;

export const LOCALES = ["en", "ar"] as const;
export type Locale = (typeof LOCALES)[number];
