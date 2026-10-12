import "server-only";
import { randomToken, sha256 } from "@/lib/crypto";
import { db } from "@/lib/db";
import { emailLocale, getEmailService } from "@/lib/services/email";
import { logActivity } from "./activity";

const TOKEN_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours

/**
 * Whether signed-in users see the "Verify your email" banner (app shell and onboarding).
 * Off unless EMAIL_VERIFICATION_BANNER="true": keep it off while verification emails
 * can't actually be delivered. Sign-up still creates and sends the link either way,
 * and /verify-email keeps working.
 */
export function verificationBannerEnabled(): boolean {
  return process.env.EMAIL_VERIFICATION_BANNER?.trim().toLowerCase() === "true";
}

/** Emails a fresh verification link (older unused links stop working). No-op when already verified. Throws EmailSendError when sending fails. */
export async function sendVerificationEmail(userId: string, baseUrl: string): Promise<boolean> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, emailVerifiedAt: true, uiPreferences: true } });
  if (!user || user.emailVerifiedAt) return false;

  const token = randomToken();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  await db.$transaction([
    db.emailVerificationToken.deleteMany({ where: { userId: user.id, usedAt: null } }),
    db.emailVerificationToken.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt } }),
  ]);

  const verifyUrl = new URL("/verify-email", baseUrl);
  verifyUrl.searchParams.set("token", token);
  await getEmailService().sendEmailVerification({ to: user.email, name: user.name, locale: emailLocale(user.uiPreferences), verifyUrl: verifyUrl.toString(), expiresAt });
  return true;
}

export type VerifyResult = "verified" | "already_verified" | "invalid";

/**
 * Confirms the address behind a link. Safe to call twice: a used link whose
 * user is verified answers "already_verified" (mail scanners often open links first).
 */
export async function verifyEmailToken(token: string): Promise<VerifyResult> {
  if (token.length < 20 || token.length > 200) return "invalid";
  const record = await db.emailVerificationToken.findUnique({
    where: { tokenHash: sha256(token) },
    select: { id: true, userId: true, expiresAt: true, usedAt: true, user: { select: { emailVerifiedAt: true, businessId: true } } },
  });
  if (!record) return "invalid";
  if (record.usedAt) return record.user.emailVerifiedAt ? "already_verified" : "invalid";
  if (record.expiresAt.getTime() <= Date.now()) return "invalid";

  const claimed = await db.emailVerificationToken.updateMany({ where: { id: record.id, usedAt: null }, data: { usedAt: new Date() } });
  if (claimed.count !== 1) return "already_verified";
  await db.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: record.user.emailVerifiedAt ?? new Date() } });
  await logActivity({ businessId: record.user.businessId, userId: record.userId, action: "user.email_verified" });
  return "verified";
}
