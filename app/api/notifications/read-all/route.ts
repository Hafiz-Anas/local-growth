import { requireFeature } from "@/lib/server/guards";
import { handler, ok } from "@/lib/server/http";
import { listNotifications, markAllNotificationsRead } from "@/lib/server/notifications";

/** POST /api/notifications/read-all — mark all of the user's notifications as read. */
export const POST = handler(async () => {
  const { session, businessId } = await requireFeature("notifications");
  await markAllNotificationsRead(session.userId, businessId);
  return ok(await listNotifications(session.userId, businessId));
});
