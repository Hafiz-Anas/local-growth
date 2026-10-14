/**
 * Why an image couldn't be generated. Shared by every ImageService
 * implementation; the route turns it into an "image_unavailable" API error and
 * the Post Generator shows "Image generation unavailable: <reason>".
 * Pure (no server-only) so it can be unit-tested.
 */
export const IMAGE_FAILURE_REASONS = [
  /** Free-tier (or plan) daily quota used up — try again tomorrow. */
  "daily_limit",
  /** Too many requests per minute, or our own per-business limit. */
  "rate_limited",
  /** The model needs billing enabled / a paid plan. */
  "billing",
  /** GEMINI_API_KEY missing, wrong, revoked or without access to the API. */
  "invalid_key",
  "not_configured",
  /** The API isn't offered in the server's region. */
  "region",
  /** The configured model doesn't exist or can't generate images. */
  "model_unavailable",
  /** The prompt or the image was blocked by the provider's safety filters. */
  "blocked",
  /** The provider answered without an image. */
  "no_image",
  /** The provider rejected the request for another reason. */
  "request_rejected",
  /** Timeout, network failure or a 5xx from the provider. */
  "unavailable",
] as const;
export type ImageFailureReason = (typeof IMAGE_FAILURE_REASONS)[number];

export class ImageGenerationError extends Error {
  constructor(
    readonly reason: ImageFailureReason,
    message: string,
    /** The provider's HTTP status, when there was a response. */
    readonly httpStatus: number | null = null,
    /** The provider's own error status/code, e.g. "RESOURCE_EXHAUSTED". */
    readonly providerCode: string | null = null,
  ) {
    super(message);
    this.name = "ImageGenerationError";
  }
}

/** Removes anything that looks like a Google API key (classic "AIza…" and newer "AQ.…" keys) before a message is logged or stored. */
export function sanitizeImageError(message: string): string {
  return message
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[redacted]")
    .replace(/\bAQ\.[0-9A-Za-z_-]{20,}/g, "[redacted]")
    .replace(/([?&](?:key|api_key)=)[^&\s"]+/gi, "$1[redacted]")
    .slice(0, 500);
}
