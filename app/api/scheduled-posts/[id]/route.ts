import { db } from "@/lib/db";
import { logActivity } from "@/lib/server/activity";
import { assertFuture } from "@/lib/server/content";
import { catalogFor } from "@/lib/server/data";
import { SCHEDULED_SELECT, toScheduled } from "@/lib/server/dto";
import { requireAnyFeature } from "@/lib/server/guards";
import { ApiError, handler, notFound, ok, readJson, readParams } from "@/lib/server/http";
import { rescheduleSchema } from "@/lib/validation/api";

const QUEUE_FEATURES = ["experiment.scheduleQueue", "postGenerator.addToQueue"] as const;

async function findOwnScheduled(businessId: string, id: string) {
  const post = await db.scheduledPost.findFirst({ where: { id, businessId }, select: { id: true, status: true, draftId: true } });
  if (!post) throw notFound("Scheduled post");
  if (post.status !== "SCHEDULED") throw new ApiError(409, "conflict", "Only upcoming posts can be changed.");
  return post;
}

/** PATCH /api/scheduled-posts/:id  { scheduledFor } — reschedule. */
export const PATCH = handler(async (request, context: RouteContext<"/api/scheduled-posts/[id]">) => {
  const { businessId, session } = await requireAnyFeature(...QUEUE_FEATURES);
  const { id } = await readParams(context, "id");
  await findOwnScheduled(businessId, id);
  const { scheduledFor } = await readJson(request, rescheduleSchema);
  assertFuture(scheduledFor);

  const updated = await db.scheduledPost.update({ where: { id }, data: { scheduledFor }, select: SCHEDULED_SELECT });
  await logActivity({ businessId, userId: session.userId, action: "post.rescheduled", details: { scheduledPostId: id, scheduledFor: scheduledFor.toISOString() } });
  const { timezone } = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { timezone: true } });
  return ok(toScheduled(updated, timezone, await catalogFor(businessId)));
});

/** DELETE /api/scheduled-posts/:id — cancel; the draft goes back to the drafts list. */
export const DELETE = handler(async (_request, context: RouteContext<"/api/scheduled-posts/[id]">) => {
  const { businessId, session } = await requireAnyFeature(...QUEUE_FEATURES);
  const { id } = await readParams(context, "id");
  const post = await findOwnScheduled(businessId, id);

  await db.$transaction(async (tx) => {
    await tx.scheduledPost.update({ where: { id }, data: { status: "CANCELLED" } });
    const stillScheduled = await tx.scheduledPost.count({ where: { draftId: post.draftId, status: "SCHEDULED" } });
    if (stillScheduled === 0) await tx.postDraft.update({ where: { id: post.draftId }, data: { status: "DRAFT" } });
    await logActivity({ businessId, userId: session.userId, action: "post.cancelled", details: { scheduledPostId: id } }, tx);
  });
  return ok({ cancelled: true });
});
