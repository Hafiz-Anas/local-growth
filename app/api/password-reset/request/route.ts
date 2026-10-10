import { ApiError, handler, ok, readJson } from "@/lib/server/http";
import { appBaseUrl, requestPasswordReset } from "@/lib/server/password-reset";
import { RESET_REQUEST_LIMIT, clientIp, getRateLimiter } from "@/lib/server/rate-limit";
import { resetRequestSchema } from "@/lib/validation/auth";

/**
 * POST /api/password-reset/request  { email }
 * Emails a single-use reset link (valid 1 hour). Responds the same whether or
 * not the account exists.
 */
export const POST = handler(async (request) => {
  const { email } = await readJson(request, resetRequestSchema);
  if (!(await getRateLimiter().consume(RESET_REQUEST_LIMIT, `${clientIp(request.headers)}:${email}`))) {
    throw new ApiError(429, "rate_limited", "Too many requests. Try again in a few minutes.");
  }
  await requestPasswordReset(email, appBaseUrl(request));
  return ok({ sent: true });
});
