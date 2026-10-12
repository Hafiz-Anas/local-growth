import { renderEmailVerification, renderOnboardingInvite, renderPasswordReset } from "./templates";
import {
  EmailSendError,
  type EmailFailureReason,
  type EmailService,
  type EmailVerificationEmail,
  type OnboardingInviteEmail,
  type PasswordResetEmail,
  type RenderedEmail,
} from "./types";

/**
 * Real email through the Resend HTTP API (https://resend.com/docs/api-reference/emails/send-email).
 * Pure: the HTTP client is injected, so tests use a stub and never call Resend.
 * The API key only ever goes into the Authorization header — it is never logged
 * or put in an error message.
 */
export interface ResendPayload {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
}

export interface ResendClient {
  send(payload: ResendPayload): Promise<{ id: string }>;
}

/** A non-2xx answer from Resend (`name` is Resend's error type, e.g. "validation_error"). */
export class ResendApiError extends Error {
  constructor(
    readonly status: number,
    readonly type: string,
    message: string,
  ) {
    super(message);
    this.name = "ResendApiError";
  }
}

const DEFAULT_API_BASE = "https://api.resend.com";
const TIMEOUT_MS = 10_000;

/** The real client: one POST /emails per message. */
export function createResendClient(options: { apiKey: string; fetch?: typeof fetch; apiBase?: string }): ResendClient {
  const doFetch = options.fetch ?? fetch;
  const base = (options.apiBase ?? DEFAULT_API_BASE).replace(/\/+$/, "");
  return {
    async send(payload) {
      const res = await doFetch(`${base}/emails`, {
        method: "POST",
        headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const body = (await res.json().catch(() => null)) as { id?: string; name?: string; message?: string } | null;
      if (!res.ok || !body?.id) {
        throw new ResendApiError(res.status, body?.name ?? "unknown_error", body?.message ?? `HTTP ${res.status}`);
      }
      return { id: body.id };
    },
  };
}

/** Maps a Resend/HTTP failure to a reason the app can act on. */
export function classifyResendError(error: unknown): { reason: EmailFailureReason; status?: number; detail: string } {
  if (error instanceof ResendApiError) {
    const reason: EmailFailureReason =
      error.status === 429 ? "rate_limited" : error.status >= 500 ? "unavailable" : "rejected"; // 400/401/403/422: bad key, unverified domain, bad address
    return { reason, status: error.status, detail: `${error.type}: ${error.message}` };
  }
  const name = error instanceof Error ? error.name : "Error";
  return { reason: "unavailable", detail: name === "TimeoutError" || name === "AbortError" ? "timeout" : `network error (${name})` };
}

type Logger = Pick<Console, "error" | "info">;

export class ResendEmailService implements EmailService {
  private readonly client: ResendClient | null;
  private readonly from: string | undefined;
  private readonly log: Logger;

  /** `client` is null when RESEND_API_KEY is missing — every send then fails with reason "config". */
  constructor(options: { client: ResendClient | null; from: string | undefined; logger?: Logger }) {
    this.client = options.client;
    this.from = options.from?.trim() || undefined;
    this.log = options.logger ?? console;
  }

  private async deliver(kind: string, to: string, email: RenderedEmail): Promise<void> {
    if (!this.client || !this.from) {
      const missing = [!this.client && "RESEND_API_KEY", !this.from && "EMAIL_FROM"].filter(Boolean).join(" and ");
      this.log.error(`[email:resend] ${kind} not sent: ${missing} not set`);
      throw new EmailSendError("config", `${missing} not set`);
    }
    try {
      const { id } = await this.client.send({ from: this.from, to: [to], subject: email.subject, html: email.html, text: email.text });
      this.log.info(`[email:resend] ${kind} sent (id ${id})`);
    } catch (error) {
      const { reason, status, detail } = classifyResendError(error);
      // Recipient domain only: enough to spot "unverified domain" problems without logging addresses.
      this.log.error(`[email:resend] ${kind} to *@${to.split("@")[1] ?? "?"} failed (${reason}${status ? `, HTTP ${status}` : ""}): ${detail}`);
      throw new EmailSendError(reason, detail, status);
    }
  }

  sendPasswordReset(message: PasswordResetEmail) {
    return this.deliver("password reset", message.to, renderPasswordReset(message));
  }

  sendEmailVerification(message: EmailVerificationEmail) {
    return this.deliver("email verification", message.to, renderEmailVerification(message));
  }

  sendOnboardingInvite(message: OnboardingInviteEmail) {
    return this.deliver("onboarding invite", message.to, renderOnboardingInvite(message));
  }
}
