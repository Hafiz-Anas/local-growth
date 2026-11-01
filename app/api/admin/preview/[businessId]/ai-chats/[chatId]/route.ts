import { db } from "@/lib/db";
import { isFeatureEnabled } from "@/lib/permissions";
import { getChat } from "@/lib/server/ai-chats";
import { requireRole } from "@/lib/server/guards";
import { handler, notFound, ok, readParams } from "@/lib/server/http";
import { getPermissionsDto } from "@/lib/server/permissions";

/** GET /api/admin/preview/:businessId/ai-chats/:chatId — read-only: one of the business's chats. */
export const GET = handler(async (_request, context: RouteContext<"/api/admin/preview/[businessId]/ai-chats/[chatId]">) => {
  await requireRole("ADMIN");
  const { businessId, chatId } = await readParams(context, "businessId", "chatId");
  if (!(await db.business.count({ where: { id: businessId } }))) throw notFound("Business");
  const { permissions } = await getPermissionsDto(businessId);
  if (!isFeatureEnabled(permissions, "aiChat")) throw notFound();
  return ok(await getChat(businessId, chatId));
});
