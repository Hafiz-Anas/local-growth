/**
 * Starting names from what sign-up knows. Pure, shared by the server and tests.
 */

/** A readable name from an Instagram username ("kuwait.bakes_kw" → "Kuwait Bakes Kw"): the business name when Instagram has no display name. */
export function displayNameFromHandle(handle: string): string {
  return titleWords(handle.replace(/^@+/, ""));
}

/** "sara.ahmad@example.com" → "Sara Ahmad": the person's starting name (sign-up asks only for email and password). */
export function nameFromEmail(email: string): string {
  return titleWords(email.split("@")[0] ?? "") || email.slice(0, 120);
}

function titleWords(text: string): string {
  return text
    .split(/[._+-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
    .slice(0, 120);
}
