/**
 * Why the text model couldn't answer. The AI service catches every one of
 * these, falls back to the template text and logs the reason to the
 * integration log — the app never shows a text-generation failure.
 * Pure (no server-only) so it can be unit-tested.
 */
export const TEXT_FAILURE_REASONS = [
  /** Free-tier (or plan) daily quota used up. */
  "daily_limit",
  /** Too many requests per minute — Google's limit or our own request gate. */
  "rate_limited",
  /** The model needs billing enabled / a paid plan ("limit: 0" on the free tier). */
  "billing",
  /** GEMINI_API_KEY wrong, revoked, or its project denied access to the API. */
  "invalid_key",
  "not_configured",
  /** The API isn't offered in the server's region. */
  "region",
  /** The configured model doesn't exist (or was retired). */
  "model_unavailable",
  /** The prompt or the answer was blocked by the provider's safety filters. */
  "blocked",
  /** The provider answered without usable text (empty, cut off, or not the JSON we asked for). */
  "bad_output",
  /** The provider rejected the request for another reason. */
  "request_rejected",
  /** Timeout, network failure or a 5xx from the provider. */
  "unavailable",
] as const;
export type TextFailureReason = (typeof TEXT_FAILURE_REASONS)[number];

export class TextGenerationError extends Error {
  constructor(
    readonly reason: TextFailureReason,
    message: string,
    /** The provider's HTTP status, when there was a response. */
    readonly httpStatus: number | null = null,
    /** The provider's own error status/code, e.g. "RESOURCE_EXHAUSTED". */
    readonly providerCode: string | null = null,
    /** How long the provider asked us to wait (RetryInfo), in ms. */
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "TextGenerationError";
  }
}

/** Removes anything that looks like a Google API key (classic "AIza…" and newer "AQ.…" keys) before a message is logged. */
export function sanitizeTextError(message: string): string {
  return message
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[redacted]")
    .replace(/\bAQ\.[0-9A-Za-z_-]{20,}/g, "[redacted]")
    .replace(/([?&](?:key|api_key)=)[^&\s"]+/gi, "$1[redacted]")
    .slice(0, 500);
}
