import "server-only";
import { db } from "@/lib/db";
import { logActivity } from "./activity";
import { ADMIN_USER_SELECT, toAdminUser } from "./dto";
import { ApiError, notFound } from "./http";

/** Suspends or reactivates a user. Suspension ends their sessions on their next request. */
export async function setUserStatus(targetId: string, status: "ACTIVE" | "SUSPENDED", actorId: string) {
  if (targetId === actorId) throw new ApiError(400, "validation_error", "You can't change your own status.");
  const before = await db.user.findUnique({ where: { id: targetId }, select: { status: true, businessId: true } });
  if (!before) throw notFound("User");
  if (before.status === status) {
    return toAdminUser(await db.user.findUniqueOrThrow({ where: { id: targetId }, select: ADMIN_USER_SELECT }));
  }
  const user = await db.$transaction(async (tx) => {
    const updated = await tx.user.update({ where: { id: targetId }, data: { status }, select: ADMIN_USER_SELECT });
    await logActivity(
      { businessId: before.businessId, userId: actorId, action: status === "SUSPENDED" ? "user.suspended" : "user.reactivated", details: { targetUserId: targetId } },
      tx,
    );
    return updated;
  });
  return toAdminUser(user);
}
