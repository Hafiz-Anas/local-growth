import "server-only";
import { decrypt, encrypt } from "@/lib/crypto";
import { db } from "@/lib/db";

/**
 * Signing in the account sign-up just created (lib/server/signup.ts): only the password's hash was kept
 * while Instagram connected, so the Auth.js "signup" provider (auth.ts) takes this ticket instead. It is
 * sealed (AES-256-GCM), lives a minute, is handed to signIn() on the server (never to the browser), and
 * works once: only for a user who has never logged in.
 */

const TICKET_TTL_MS = 60 * 1000;

export function signupTicket(userId: string): string {
  return encrypt(JSON.stringify({ u: userId, e: Date.now() + TICKET_TTL_MS }));
}

/** The new user's id, marking the first login; null for a forged, expired or used ticket. */
export async function redeemSignupTicket(ticket: string): Promise<string | null> {
  let parsed: { u?: unknown; e?: unknown };
  try {
    parsed = JSON.parse(decrypt(ticket));
  } catch {
    return null;
  }
  if (typeof parsed.u !== "string" || typeof parsed.e !== "number" || parsed.e < Date.now()) return null;
  const used = await db.user.updateMany({ where: { id: parsed.u, role: "USER", status: "ACTIVE", lastLoginAt: null }, data: { lastLoginAt: new Date() } });
  return used.count === 1 ? parsed.u : null;
}
