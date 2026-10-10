import "server-only";

/**
 * Outgoing email. Routes and services depend on this interface only; pick the
 * implementation with EMAIL_PROVIDER. Add an SMTP/Resend/SES class here and a
 * case in `getEmailService()` to send real mail.
 */
export interface PasswordResetEmail {
  to: string;
  name: string;
  resetUrl: string;
  expiresAt: Date;
}

export interface EmailVerificationEmail {
  to: string;
  name: string;
  verifyUrl: string;
  expiresAt: Date;
}

/** Sent when an admin asks an existing client to set up their brand profile. */
export interface OnboardingInviteEmail {
  to: string;
  name: string;
  businessName: string;
  loginUrl: string;
}

export interface EmailService {
  sendPasswordReset(message: PasswordResetEmail): Promise<void>;
  sendEmailVerification(message: EmailVerificationEmail): Promise<void>;
  sendOnboardingInvite(message: OnboardingInviteEmail): Promise<void>;
}

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
    default:
      throw new Error(`Unknown EMAIL_PROVIDER "${provider}".`);
  }
  return instance;
}
