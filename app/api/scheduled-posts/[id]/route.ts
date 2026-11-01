import { db } from "@/lib/db";
import { assertFuture } from "@/lib/server/content";
import { catalogFor } from "@/lib/server/data";
import { SCHEDULED_SELECT, toScheduled } from "@/lib/server/dto";
import { requireAnyFeature } from "@/lib/server/guards";
import { handler, ok, readJson, readParams } from "@/lib/server/http";
import { PUBLISH_FEATURES, cancelPost, reschedulePost } from "@/lib/server/publishing";
import { rescheduleSchema } from "@/lib/validation/api";

/**
 * PATCH /api/scheduled-posts/:id  { scheduledFor } | { now: true } — move an upcoming post, or try a failed one
 * again (at a time, or now). A failed post that reached Instagram's containers is checked first, never posted twice.
 * 409 publish_started once publishing has begun.
 */
export const PATCH = handler(async (request, context: RouteContext<"/api/scheduled-posts/[id]">) => {
  const { businessId, session } = await requireAnyFeature(...PUBLISH_FEATURES);
  const { id } = await readParams(context, "id");
  const body = await readJson(request, rescheduleSchema);
  const at = "scheduledFor" in body ? body.scheduledFor : null;
  if (at) assertFuture(at);
  await reschedulePost(businessId, session.userId, id, at);

  const row = await db.scheduledPost.findUniqueOrThrow({ where: { id }, select: SCHEDULED_SELECT });
  const { timezone } = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { timezone: true } });
  return ok(toScheduled(row, timezone, await catalogFor(businessId)));
});

/** DELETE /api/scheduled-posts/:id — cancel an upcoming post or dismiss a failed one; the draft goes back to the drafts. */
export const DELETE = handler(async (_request, context: RouteContext<"/api/scheduled-posts/[id]">) => {
  const { businessId, session } = await requireAnyFeature(...PUBLISH_FEATURES);
  const { id } = await readParams(context, "id");
  await cancelPost(businessId, session.userId, id);
  return ok({ cancelled: true });
});
