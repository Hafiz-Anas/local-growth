import { db } from "@/lib/db";
import { requireRole } from "@/lib/server/guards";
import { handler, notFound, ok, readJson, readParams } from "@/lib/server/http";
import { setPassword } from "@/lib/server/passwords";
import { adminResetPasswordSchema } from "@/lib/validation/api";

/**
 * POST /api/admin/users/:id/reset-password  { password }
 * Sets a new password now and signs the user out everywhere (there are no reset emails: the admin tells the
 * person the new password). Logged by setPassword() with the admin as the actor.
 */
export const POST = handler(async (request, context: RouteContext<"/api/admin/users/[id]/reset-password">) => {
  const session = await requireRole("ADMIN");
  const { id } = await readParams(context, "id");
  if (!(await db.user.count({ where: { id } }))) throw notFound("User");
  const { password } = await readJson(request, adminResetPasswordSchema);
  await setPassword(id, password, { actorId: session.userId, action: "admin.user_password_reset" });
  return ok({ reset: true, sessionsRevoked: true });
});
