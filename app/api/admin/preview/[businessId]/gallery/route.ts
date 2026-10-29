import { db } from "@/lib/db";
import { isFeatureEnabled } from "@/lib/permissions";
import { getGallery } from "@/lib/server/gallery";
import { requireRole } from "@/lib/server/guards";
import { handler, notFound, ok, readParams } from "@/lib/server/http";
import { getPermissionsDto } from "@/lib/server/permissions";

/** GET /api/admin/preview/:businessId/gallery — read-only: the business's Gallery as its owner sees it ("Preview as this client"). */
export const GET = handler(async (_request, context: RouteContext<"/api/admin/preview/[businessId]/gallery">) => {
  await requireRole("ADMIN");
  const { businessId } = await readParams(context, "businessId");
  if (!(await db.business.count({ where: { id: businessId } }))) throw notFound("Business");
  const { permissions } = await getPermissionsDto(businessId);
  if (!isFeatureEnabled(permissions, "gallery") && !isFeatureEnabled(permissions, "aiChat")) throw notFound();
  return ok(await getGallery(businessId));
});
