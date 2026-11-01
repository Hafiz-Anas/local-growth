import { db } from "@/lib/db";
import { isFeatureEnabled } from "@/lib/permissions";
import { listChats } from "@/lib/server/ai-chats";
import { requireRole } from "@/lib/server/guards";
import { handler, notFound, ok, readParams } from "@/lib/server/http";
import { getPermissionsDto } from "@/lib/server/permissions";

/** GET /api/admin/preview/:businessId/ai-chats — read-only: the business's AI tab chats ("Preview as this client"). */
export const GET = handler(async (_request, context: RouteContext<"/api/admin/preview/[businessId]/ai-chats">) => {
  await requireRole("ADMIN");
  const { businessId } = await readParams(context, "businessId");
  if (!(await db.business.count({ where: { id: businessId } }))) throw notFound("Business");
  const { permissions } = await getPermissionsDto(businessId);
  if (!isFeatureEnabled(permissions, "aiChat")) throw notFound();
  // Preview never adds the sample chats.
  return ok({ ...(await listChats(businessId)), sampleDue: false });
});
