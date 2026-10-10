import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { logActivity } from "@/lib/server/activity";
import { ADMIN_USER_SELECT, toAdminUser } from "@/lib/server/dto";
import { requireRole } from "@/lib/server/guards";
import { ApiError, handler, ok, readJson, readQuery } from "@/lib/server/http";
import { adminListUsersQuery, createUserSchema } from "@/lib/validation/api";

/** GET /api/admin/users?q=&role=&status=&businessId= */
export const GET = handler(async (request) => {
  await requireRole("ADMIN");
  const { q, role, status, businessId } = readQuery(request, adminListUsersQuery);
  const rows = await db.user.findMany({
    where: {
      ...(role && { role: role === "admin" ? "ADMIN" : "USER" }),
      ...(status && { status: status === "active" ? "ACTIVE" : "SUSPENDED" }),
      ...(businessId && { businessId }),
      ...(q && { OR: [{ email: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] }),
    },
    select: ADMIN_USER_SELECT,
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
  });
  return ok(rows.map(toAdminUser));
});

/** POST /api/admin/users  { email, name, password, role, businessId?, avatarUrl? } */
export const POST = handler(async (request) => {
  const session = await requireRole("ADMIN");
  const input = await readJson(request, createUserSchema);
  if (input.businessId && !(await db.business.count({ where: { id: input.businessId } }))) {
    throw new ApiError(400, "validation_error", "Unknown business.");
  }

  const passwordHash = await hashPassword(input.password);
  const user = await db.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        // Created by an admin, so the address counts as verified.
        emailVerifiedAt: new Date(),
        email: input.email,
        name: input.name,
        passwordHash,
        role: input.role === "admin" ? "ADMIN" : "USER",
        businessId: input.businessId ?? null,
        avatarUrl: input.avatarUrl ?? null,
      },
      select: ADMIN_USER_SELECT,
    });
    await logActivity({ businessId: created.business?.id ?? null, userId: session.userId, action: "user.created", details: { targetUserId: created.id, email: created.email, role: input.role } }, tx);
    return created;
  });
  return ok(toAdminUser(user), { status: 201 });
});
