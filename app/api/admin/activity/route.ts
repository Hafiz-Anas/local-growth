import { db } from "@/lib/db";
import { requireRole } from "@/lib/server/guards";
import { handler, idSchema, ok, readQuery } from "@/lib/server/http";
import { activityQuery } from "@/lib/validation/api";
import type { ActivityLogDto, Paginated } from "@/types";

/** GET /api/admin/activity?businessId=&action=&cursor=&limit= — newest first, cursor-paginated. */
export const GET = handler(async (request) => {
  await requireRole("ADMIN");
  const { businessId, action, cursor, limit } = readQuery(request, activityQuery);
  const validCursor = cursor && idSchema.safeParse(cursor).success ? cursor : undefined;

  const rows = await db.activityLog.findMany({
    where: { ...(businessId && { businessId }), ...(action && { action: { startsWith: action } }) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(validCursor && { cursor: { id: validCursor }, skip: 1 }),
    select: {
      id: true,
      action: true,
      details: true,
      createdAt: true,
      business: { select: { id: true, name: true } },
      user: { select: { id: true, name: true, role: true } },
    },
  });

  const page = rows.slice(0, limit);
  const result: Paginated<ActivityLogDto> = {
    items: page.map((row) => ({
      id: row.id,
      action: row.action,
      details: row.details,
      createdAt: row.createdAt.toISOString(),
      business: row.business,
      user: row.user ? { id: row.user.id, name: row.user.name, role: row.user.role === "ADMIN" ? "admin" : "user" } : null,
    })),
    nextCursor: rows.length > limit ? page[page.length - 1].id : null,
  };
  return ok(result);
});
