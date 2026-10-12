import type { FeatureKey } from "./permissions";

export type Role = "admin" | "user";

/** Dark is the default; the old "system" value is read as dark (normalizeTheme). */
export type ThemePreference = "light" | "dark";

/** Stored in `User.uiPreferences`. */
export interface UiPreferences {
  sidebarCollapsed: boolean;
  theme: ThemePreference;
  language: "en" | "ar";
}

/** Public user shape — never includes credentials or token hashes. */
export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  /** Profile picture path/URL; `null` falls back to initials. */
  avatarUrl: string | null;
  /** Set for role "user": the business this login manages. */
  businessId: string | null;
}

/**
 * The signed-in user as the app sees it. Carried in the Auth.js JWT (httpOnly
 * cookie) and refreshed from the database every few seconds — see auth.ts.
 */
export interface Session {
  userId: string;
  role: Role;
  email: string;
  name: string;
  avatarUrl: string | null;
  businessId: string | null;
  /** Effective feature keys for the user's business (empty for admins). */
  features: FeatureKey[];
}
