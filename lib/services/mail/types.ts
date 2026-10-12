import type { Locale } from "@/config/site";

/**
 * Outgoing email contract. Pure (no server-only) so the templates and the
 * Resend implementation can be tested; `lib/services/email.ts` picks the
 * implementation with EMAIL_PROVIDER.
 */
export interface PasswordResetEmail {
  to: string;
  name: string;
  locale: Locale;
  resetUrl: string;
  expiresAt: Date;
}

export interface EmailVerificationEmail {
  to: string;
  name: string;
  locale: Locale;
  verifyUrl: string;
  expiresAt: Date;
}

/** Sent when an admin asks an existing client to set up their brand profile. */
export interface OnboardingInviteEmail {
  to: string;
  name: string;
  locale: Locale;
  businessName: string;
  loginUrl: string;
}

export interface EmailService {
  sendPasswordReset(message: PasswordResetEmail): Promise<void>;
  sendEmailVerification(message: EmailVerificationEmail): Promise<void>;
  sendOnboardingInvite(message: OnboardingInviteEmail): Promise<void>;
}

/** A rendered message, ready for any provider. */
export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Why a send failed:
 *  - config: RESEND_API_KEY / EMAIL_FROM missing
 *  - rejected: the provider refused it (bad key, unverified sending domain, invalid address)
 *  - rate_limited: provider quota
 *  - unavailable: provider down, timeout or network error
 */
export type EmailFailureReason = "config" | "rejected" | "rate_limited" | "unavailable";

/** Thrown by every EmailService when a message could not be sent. Never carries secrets. */
export class EmailSendError extends Error {
  constructor(
    readonly reason: EmailFailureReason,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "EmailSendError";
  }
}

/** The language an email goes out in: the user's saved language, else English. */
export function emailLocale(uiPreferences: unknown): Locale {
  const language = (uiPreferences as { language?: unknown } | null)?.language;
  return language === "ar" ? "ar" : "en";
}
