import { db } from "@/lib/db";
import { getBrandProfile } from "@/lib/server/brand";
import { requireRole } from "@/lib/server/guards";
import { handler, notFound, ok, readParams } from "@/lib/server/http";

/** GET /api/admin/businesses/:id/brand — a client's brand context and brand posts (read-only for admins). */
export const GET = handler(async (_request, context: RouteContext<"/api/admin/businesses/[id]/brand">) => {
  await requireRole("ADMIN");
  const { id } = await readParams(context, "id");
  if (!(await db.business.count({ where: { id } }))) throw notFound("Business");
  return ok(await getBrandProfile(id));
});
