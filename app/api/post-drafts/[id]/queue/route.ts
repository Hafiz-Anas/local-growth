import { db } from "@/lib/db";
import { logActivity } from "@/lib/server/activity";
import { assertFuture, findOwnDraft } from "@/lib/server/content";
import { catalogFor } from "@/lib/server/data";
import { SCHEDULED_SELECT, toScheduled } from "@/lib/server/dto";
import { requireFeature } from "@/lib/server/guards";
import { ApiError, handler, ok, readJson, readParams } from "@/lib/server/http";
import { queueDraftSchema } from "@/lib/validation/api";

/** POST /api/post-drafts/:id/queue  { scheduledFor, mediaUrl? } — schedule a draft for publishing (with the draft's image unless mediaUrl is given). */
export const POST = handler(async (request, context: RouteContext<"/api/post-drafts/[id]/queue">) => {
  const { businessId, session } = await requireFeature("postGenerator.addToQueue");
  const { id } = await readParams(context, "id");
  const draft = await findOwnDraft(businessId, id);
  if (draft.status !== "DRAFT") throw new ApiError(409, "conflict", "This draft is already queued, published or rejected.");
  const { scheduledFor, mediaUrl } = await readJson(request, queueDraftSchema);
  assertFuture(scheduledFor);

  const scheduled = await db.$transaction(async (tx) => {
    await tx.postDraft.update({ where: { id }, data: { status: "QUEUED" } });
    const post = await tx.scheduledPost.create({ data: { businessId, draftId: id, scheduledFor, mediaUrl: mediaUrl ?? draft.imageUrl ?? null }, select: SCHEDULED_SELECT });
    await logActivity({ businessId, userId: session.userId, action: "post.queued", details: { draftId: id, scheduledFor: scheduledFor.toISOString() } }, tx);
    return post;
  });
  const { timezone } = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { timezone: true } });
  return ok(toScheduled(scheduled, timezone, await catalogFor(businessId)), { status: 201 });
});
