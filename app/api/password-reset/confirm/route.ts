import { ApiError, handler, ok, readJson } from "@/lib/server/http";
import { completePasswordReset } from "@/lib/server/password-reset";
import { RESET_CONFIRM_LIMIT, clientIp, getRateLimiter } from "@/lib/server/rate-limit";
import { resetConfirmSchema } from "@/lib/validation/auth";

/**
 * POST /api/password-reset/confirm  { token, password }
 * Sets a new password with a valid, unused, unexpired reset token and signs
 * the user out everywhere.
 */
export const POST = handler(async (request) => {
  if (!(await getRateLimiter().consume(RESET_CONFIRM_LIMIT, clientIp(request.headers)))) {
    throw new ApiError(429, "rate_limited", "Too many attempts. Try again in a few minutes.");
  }
  const { token, password } = await readJson(request, resetConfirmSchema);
  if (!(await completePasswordReset(token, password))) throw new ApiError(400, "invalid_token", "This reset link is invalid or has expired.");
  return ok({ reset: true });
});
