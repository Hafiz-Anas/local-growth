/**
 * Usernames (sign-up and login). Pure, shared by the forms and the server (tests/usernames.test.ts).
 *
 * Rules: 3–30 characters, letters, numbers, "_" and "."; unique without regard to case (stored lower case).
 * Older accounts keep their email and can log in with either. Every account still has an `email` column
 * (it is required and unique), so an account made with a username gets an internal placeholder address,
 * `<username>@users.invalid` — never shown, never mailed (the ".invalid" domain is reserved for exactly that).
 */

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;
export const PLACEHOLDER_EMAIL_DOMAIN = "users.invalid";

export type UsernameProblem = "required" | "too_short" | "too_long" | "characters";

/** The stored form: trimmed, lower case. */
export const normalizeUsername = (raw: string) => raw.trim().toLowerCase();

/** What's wrong with a username, as a code the form translates (null = fine). Case doesn't matter. */
export function usernameProblem(raw: string): UsernameProblem | null {
  const name = normalizeUsername(raw);
  if (!name) return "required";
  if (!/^[a-z0-9_.]+$/.test(name)) return "characters";
  if (name.length < USERNAME_MIN) return "too_short";
  if (name.length > USERNAME_MAX) return "too_long";
  return null;
}

export const placeholderEmail = (username: string) => `${normalizeUsername(username)}@${PLACEHOLDER_EMAIL_DOMAIN}`;

export const isPlaceholderEmail = (email: string) => email.toLowerCase().endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`);

/** The username behind a placeholder address, else null. */
export function usernameFromPlaceholder(email: string): string | null {
  return isPlaceholderEmail(email) ? email.slice(0, email.lastIndexOf("@")).toLowerCase() : null;
}

/** What to show for a login: the username, or the real email of an older account. */
export const loginName = (email: string, username?: string | null) => username ?? usernameFromPlaceholder(email) ?? email;

/**
 * The stored identity of an account an admin creates: a username (email optional, else the placeholder) or an
 * email alone (an older-style login). The schemas guarantee at least one of the two.
 */
export function resolveIdentity(input: { username?: string | null; email?: string | null }): { username: string | null; email: string } {
  const username = input.username ? normalizeUsername(input.username) : null;
  const email = input.email?.trim().toLowerCase() || (username ? placeholderEmail(username) : "");
  return { username, email };
}

/** A login form's single field: an email when it has an "@" (usernames can't), else a username. */
export function parseIdentifier(raw: string): { kind: "email" | "username"; value: string } {
  const value = raw.trim().toLowerCase();
  return { kind: value.includes("@") ? "email" : "username", value };
}
