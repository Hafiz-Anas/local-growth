import { db } from "@/lib/db";
import { sendVerificationEmail } from "@/lib/server/email-verification";
import { requireAuth } from "@/lib/server/guards";
import { ApiError, handler, ok } from "@/lib/server/http";
import { appBaseUrl } from "@/lib/server/password-reset";
import { VERIFY_RESEND_LIMIT, getRateLimiter } from "@/lib/server/rate-limit";

/** GET /api/me/verify-email — whether the signed-in user's address is verified (polled by the banner). */
export const GET = handler(async () => {
  const session = await requireAuth();
  const user = await db.user.findUnique({ where: { id: session.userId }, select: { emailVerifiedAt: true } });
  return ok({ verified: Boolean(user?.emailVerifiedAt) }, { headers: { "Cache-Control": "no-store" } });
});

/** POST /api/me/verify-email — send a new verification link (3 per 15 minutes). */
export const POST = handler(async (request) => {
  const session = await requireAuth();
  const user = await db.user.findUnique({ where: { id: session.userId }, select: { emailVerifiedAt: true } });
  if (user?.emailVerifiedAt) throw new ApiError(409, "conflict", "Your email is already verified.", [{ path: "email", message: "already_verified" }]);
  if (!(await getRateLimiter().consume(VERIFY_RESEND_LIMIT, session.userId))) throw new ApiError(429, "rate_limited", "Too many emails. Try again in a few minutes.");
  await sendVerificationEmail(session.userId, appBaseUrl(request));
  return ok({ sent: true });
});
