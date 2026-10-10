import { db } from "@/lib/db";
import { logActivity } from "@/lib/server/activity";
import { requireRole } from "@/lib/server/guards";
import { handler, notFound, ok, readJson, readParams } from "@/lib/server/http";
import { appBaseUrl, requestPasswordReset } from "@/lib/server/password-reset";
import { setPassword } from "@/lib/server/passwords";
import { adminResetPasswordSchema } from "@/lib/validation/api";

/**
 * POST /api/admin/users/:id/reset-password
 *   { password }        → sets it now and signs the user out everywhere
 *   { sendEmail: true } → emails the user a reset link instead
 */
export const POST = handler(async (request, context: RouteContext<"/api/admin/users/[id]/reset-password">) => {
  const session = await requireRole("ADMIN");
  const { id } = await readParams(context, "id");
  const user = await db.user.findUnique({ where: { id }, select: { email: true, businessId: true } });
  if (!user) throw notFound("User");
  const body = await readJson(request, adminResetPasswordSchema);

  if ("password" in body) {
    await setPassword(id, body.password, { actorId: session.userId, action: "admin.user_password_reset" });
    return ok({ reset: true, sessionsRevoked: true });
  }
  await requestPasswordReset(user.email, appBaseUrl(request));
  await logActivity({ businessId: user.businessId, userId: session.userId, action: "admin.user_reset_link_sent", details: { targetUserId: id } });
  return ok({ emailSent: true });
});
