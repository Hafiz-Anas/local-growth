import "server-only";
import { randomToken, sha256 } from "@/lib/crypto";
import { db } from "@/lib/db";
import { emailLocale, getEmailService } from "@/lib/services/email";
import { setPassword } from "./passwords";

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Starts a reset for the email if it belongs to an active user. Resolves the
 * same way whether or not the account exists; throws EmailSendError only when
 * the provider fails (the link stays unsent, the user can ask again).
 */
export async function requestPasswordReset(email: string, baseUrl: string): Promise<void> {
  const user = await db.user.findUnique({ where: { email }, select: { id: true, name: true, email: true, status: true, uiPreferences: true } });
  if (!user || user.status !== "ACTIVE") return;

  const token = randomToken();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  await db.$transaction([
    // Only the newest link works.
    db.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } }),
    db.passwordResetToken.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt } }),
  ]);

  const resetUrl = new URL("/reset-password", baseUrl);
  resetUrl.searchParams.set("token", token);
  await getEmailService().sendPasswordReset({ to: user.email, name: user.name, locale: emailLocale(user.uiPreferences), resetUrl: resetUrl.toString(), expiresAt });
}

async function findUsableToken(token: string) {
  const record = await db.passwordResetToken.findUnique({
    where: { tokenHash: sha256(token) },
    select: { id: true, userId: true, expiresAt: true, usedAt: true, user: { select: { status: true } } },
  });
  if (!record || record.usedAt || record.expiresAt.getTime() <= Date.now() || record.user.status !== "ACTIVE") return null;
  return record;
}

/** For the reset page: is this link still usable? (Does not consume it.) */
export async function isResetTokenValid(token: string): Promise<boolean> {
  return (await findUsableToken(token)) !== null;
}

/**
 * Sets the new password, burns the token and ends all of the user's existing
 * sessions. Returns false for an invalid/expired/used link.
 */
export async function completePasswordReset(token: string, password: string): Promise<boolean> {
  const record = await findUsableToken(token);
  if (!record) return false;

  // Mark used first, conditionally, so two concurrent requests can't both succeed.
  const claimed = await db.passwordResetToken.updateMany({ where: { id: record.id, usedAt: null }, data: { usedAt: new Date() } });
  if (claimed.count !== 1) return false;

  await setPassword(record.userId, password, { actorId: record.userId, action: "user.password_reset" });
  return true;
}

/** Public base URL for links in emails: AUTH_URL (the live domain in production), else the request origin. */
export function appBaseUrl(request: Request): string {
  return process.env.AUTH_URL ?? new URL(request.url).origin;
}
