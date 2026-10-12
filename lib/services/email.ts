import "server-only";
import { createResendClient, ResendEmailService } from "./mail/resend";
import type { EmailService, EmailVerificationEmail, OnboardingInviteEmail, PasswordResetEmail } from "./mail/types";

/**
 * Outgoing email. Routes and services depend on this interface only; pick the
 * implementation with EMAIL_PROVIDER: "console" (default, prints to the server
 * log) or "resend" (RESEND_API_KEY + EMAIL_FROM). Templates and the Resend
 * client are pure code in `lib/services/mail/` (tested in tests/email/).
 * Every implementation throws EmailSendError on failure; `handler()` turns it
 * into a friendly `email_unavailable` response.
 */
export * from "./mail/types";

/** Development: prints each message (with its link) to the server console. */
export class ConsoleEmailService implements EmailService {
  private print(title: string, to: string, lines: string[]) {
    const from = process.env.EMAIL_FROM ?? "Local Growth Engine";
    console.info(
      ["", `──────── [email:console] ${title} ────────`, `From:    ${from}`, `To:      ${to}`, ...lines, "────────────────────────────────────────────────", ""].join("\n"),
    );
  }

  async sendPasswordReset({ to, name, resetUrl, expiresAt }: PasswordResetEmail) {
    this.print("Password reset", `${name} <${to}>`, [`Expires: ${expiresAt.toISOString()}`, `Link:    ${resetUrl}`]);
  }

  async sendEmailVerification({ to, name, verifyUrl, expiresAt }: EmailVerificationEmail) {
    this.print("Verify your email", `${name} <${to}>`, [`Expires: ${expiresAt.toISOString()}`, `Link:    ${verifyUrl}`]);
  }

  async sendOnboardingInvite({ to, name, businessName, loginUrl }: OnboardingInviteEmail) {
    this.print("Set up your brand profile", `${name} <${to}>`, [`Business: ${businessName}`, `Link:     ${loginUrl}`]);
  }
}

let instance: EmailService | null = null;

export function getEmailService(): EmailService {
  if (instance) return instance;
  const provider = process.env.EMAIL_PROVIDER ?? "console";
  switch (provider) {
    case "console":
      instance = new ConsoleEmailService();
      break;
    case "resend": {
      const apiKey = process.env.RESEND_API_KEY?.trim();
      instance = new ResendEmailService({
        client: apiKey ? createResendClient({ apiKey, apiBase: process.env.RESEND_API_BASE }) : null,
        from: process.env.EMAIL_FROM,
      });
      break;
    }
    default:
      throw new Error(`Unknown EMAIL_PROVIDER "${provider}".`);
  }
  return instance;
}
