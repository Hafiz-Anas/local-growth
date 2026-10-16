import { requireFeature } from "@/lib/server/guards";
import { handler, ok, readParams } from "@/lib/server/http";
import { listNotifications, markNotificationRead } from "@/lib/server/notifications";

/** PATCH /api/notifications/:id — mark one of the user's notifications as read. */
export const PATCH = handler(async (_request, context: RouteContext<"/api/notifications/[id]">) => {
  const { session, businessId } = await requireFeature("notifications");
  const { id } = await readParams(context, "id");
  await markNotificationRead(session.userId, businessId, id);
  return ok(await listNotifications(session.userId, businessId));
});
