import "server-only";
import { InstagramNotConnectedError, InstagramPermissionError, InstagramRateLimitedError } from "@/lib/services/instagram";
import { ApiError } from "./http";

/**
 * InstagramService errors → API errors the UI explains:
 *   not connected / token revoked → 409 instagram_not_connected (Connect/Reconnect prompt)
 *   permission not granted        → 403 instagram_permission, details name the permission
 *   Meta rate limit               → 429 rate_limited
 *   anything else                 → 502 instagram_error with `fallback`
 */
export function instagramApiError(error: unknown, fallback: string): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof InstagramNotConnectedError) return new ApiError(409, "instagram_not_connected", "Connect Instagram again to continue.");
  if (error instanceof InstagramPermissionError) {
    return new ApiError(403, "instagram_permission", error.message, error.permissions.map((p) => ({ path: "permission", message: p })));
  }
  if (error instanceof InstagramRateLimitedError) return new ApiError(429, "rate_limited", "Instagram asked us to slow down. Try again in a few minutes.");
  return new ApiError(502, "instagram_error", fallback);
}

/** Reason recorded on onboarding error events for a failed competitor lookup. */
export function lookupFailureReason(error: unknown): string {
  if (error instanceof InstagramNotConnectedError) return "not_connected";
  if (error instanceof InstagramPermissionError) return "permission_missing";
  if (error instanceof InstagramRateLimitedError) return "rate_limited";
  return "lookup_failed";
}
