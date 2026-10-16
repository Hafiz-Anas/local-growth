import { db } from "@/lib/db";
import { logActivity } from "@/lib/server/activity";
import { ADMIN_USER_SELECT, toAdminUser } from "@/lib/server/dto";
import { requireRole } from "@/lib/server/guards";
import { ApiError, handler, notFound, ok, readJson, readParams } from "@/lib/server/http";
import { updateUserSchema } from "@/lib/validation/api";

type Ctx = RouteContext<"/api/admin/users/[id]">;

/** GET /api/admin/users/:id */
export const GET = handler(async (_request, context: Ctx) => {
  await requireRole("ADMIN");
  const { id } = await readParams(context, "id");
  const user = await db.user.findUnique({ where: { id }, select: ADMIN_USER_SELECT });
  if (!user) throw notFound("User");
  return ok(toAdminUser(user));
});

/**
 * PATCH /api/admin/users/:id  { email?, name?, role?, businessId?, avatarUrl? }
 * The resulting user must be consistent: USER ↔ has a business, ADMIN ↔ none.
 * A new businessId moves the login from its active Instagram account to that one (its other
 * accounts stay); turning it into an admin removes every account.
 * Changes reach the user's live sessions on their next request.
 */
export const PATCH = handler(async (request, context: Ctx) => {
  const session = await requireRole("ADMIN");
  const { id } = await readParams(context, "id");
  const before = await db.user.findUnique({ where: { id }, select: { role: true, businessId: true } });
  if (!before) throw notFound("User");
  const patch = await readJson(request, updateUserSchema);

  if (id === session.userId && patch.role && patch.role !== "admin") throw new ApiError(400, "validation_error", "You can't remove your own admin role.");
  const role = patch.role ? (patch.role === "admin" ? "ADMIN" : "USER") : before.role;
  const businessId = patch.businessId !== undefined ? patch.businessId : role === "ADMIN" ? null : before.businessId;
  if (role === "USER" && !businessId) throw new ApiError(400, "validation_error", "Users need a business.");
  if (role === "ADMIN" && businessId) throw new ApiError(400, "validation_error", "Admins can't belong to a business.");
  if (businessId && businessId !== before.businessId && !(await db.business.count({ where: { id: businessId } }))) {
    throw new ApiError(400, "validation_error", "Unknown business.");
  }

  const user = await db.$transaction(async (tx) => {
    if (businessId !== before.businessId) {
      if (role === "ADMIN") await tx.businessMember.deleteMany({ where: { userId: id } });
      else if (before.businessId) await tx.businessMember.deleteMany({ where: { userId: id, businessId: before.businessId } });
      if (businessId) await tx.businessMember.upsert({ where: { userId_businessId: { userId: id, businessId } }, update: {}, create: { userId: id, businessId } });
    }
    const updated = await tx.user.update({
      where: { id },
      data: {
        ...(patch.email !== undefined && { email: patch.email }),
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.avatarUrl !== undefined && { avatarUrl: patch.avatarUrl }),
        role,
        businessId,
      },
      select: ADMIN_USER_SELECT,
    });
    await logActivity({ businessId: businessId ?? before.businessId, userId: session.userId, action: "user.updated", details: { targetUserId: id, fields: Object.keys(patch) } }, tx);
    return updated;
  });
  return ok(toAdminUser(user));
});
