/** The format checks for an AI key, safe for the browser (no Node imports): used by the admin form and the server. */

export type KeyProblem = "empty" | "too_short" | "too_long" | "spaces" | "characters";

/** What's wrong with a key typed by an admin (a format check only; "Test key" asks Google). */
export function keyProblem(raw: string): KeyProblem | null {
  const key = raw.trim();
  if (!key) return "empty";
  if (/\s/.test(key)) return "spaces";
  if (key.length < 20) return "too_short";
  if (key.length > 200) return "too_long";
  if (!/^[\x21-\x7e]+$/.test(key)) return "characters";
  return null;
}

/** The last 4 characters: the only part of a key that ever leaves the server. */
export const keyLast4 = (apiKey: string) => apiKey.trim().slice(-4);

/** "••••••••abcd" for showing a saved key. */
export const maskedKey = (last4: string) => `••••••••${last4}`;
