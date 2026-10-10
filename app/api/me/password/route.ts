import { signIn } from "@/auth";
import { verifyPassword } from "@/lib/auth/password";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/server/guards";
import { ApiError, handler, ok, readJson } from "@/lib/server/http";
import { setPassword } from "@/lib/server/passwords";
import { PASSWORD_CHANGE_LIMIT, getRateLimiter } from "@/lib/server/rate-limit";
import { changePasswordSchema } from "@/lib/validation/api";

/**
 * PATCH /api/me/password  { currentPassword, newPassword }
 * Changes the password and signs the user out of every other session. The
 * session making this request is re-issued, so the user stays signed in here.
 */
export const PATCH = handler(async (request) => {
  const session = await requireAuth();
  if (!(await getRateLimiter().consume(PASSWORD_CHANGE_LIMIT, session.userId))) {
    throw new ApiError(429, "rate_limited", "Too many attempts. Try again in a few minutes.");
  }
  const { currentPassword, newPassword } = await readJson(request, changePasswordSchema);

  const user = await db.user.findUniqueOrThrow({ where: { id: session.userId }, select: { email: true, passwordHash: true } });
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new ApiError(400, "invalid_password", "Your current password is incorrect.");
  }

  await setPassword(session.userId, newPassword, { actorId: session.userId, action: "user.password_changed" });

  // Every existing session is now revoked, including this one — issue a fresh cookie for it.
  let signedIn = true;
  try {
    await signIn("credentials", { email: user.email, password: newPassword, redirect: false });
  } catch {
    signedIn = false;
  }
  return ok({ changed: true, signedIn });
});
