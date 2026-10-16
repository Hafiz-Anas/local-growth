import { requireFeature } from "@/lib/server/guards";
import { handler, ok } from "@/lib/server/http";
import { listNotifications } from "@/lib/server/notifications";

/** GET /api/notifications — the signed-in user's latest notifications for the active Instagram account and unread count. */
export const GET = handler(async () => {
  const { session, businessId } = await requireFeature("notifications");
  return ok(await listNotifications(session.userId, businessId));
});
