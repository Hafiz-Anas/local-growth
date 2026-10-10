import { db } from "@/lib/db";
import { requireAuth } from "@/lib/server/guards";
import { handler, ok, readJson } from "@/lib/server/http";
import { notificationPrefsPatchSchema, notificationPrefsSchema } from "@/lib/validation/api";

/** PATCH /api/me/notifications  { newComments?, approvalNeeded?, … } — merged into User.notificationPrefs. */
export const PATCH = handler(async (request) => {
  const session = await requireAuth();
  const patch = await readJson(request, notificationPrefsPatchSchema);
  const user = await db.user.findUniqueOrThrow({ where: { id: session.userId }, select: { notificationPrefs: true } });
  const current = notificationPrefsSchema.catch(notificationPrefsSchema.parse({})).parse(user.notificationPrefs ?? {});
  const notifications = { ...current, ...patch };
  await db.user.update({ where: { id: session.userId }, data: { notificationPrefs: notifications } });
  return ok({ notifications });
});
