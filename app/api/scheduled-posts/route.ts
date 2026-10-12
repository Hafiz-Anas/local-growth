import { db } from "@/lib/db";
import type { ScheduledPostStatus } from "@/lib/generated/prisma/client";
import { logActivity } from "@/lib/server/activity";
import { assertFuture, findOwnDraft } from "@/lib/server/content";
import { catalogFor, listScheduled } from "@/lib/server/data";
import { SCHEDULED_SELECT, toScheduled } from "@/lib/server/dto";
import { requireAnyFeature } from "@/lib/server/guards";
import { ApiError, handler, ok, readJson, readQuery } from "@/lib/server/http";
import { createScheduledSchema, scheduledStatusQuery } from "@/lib/validation/api";

/** The posting queue is reachable from the experiment's queue or the generator's "Add to queue". */
const QUEUE_FEATURES = ["experiment.scheduleQueue", "postGenerator.addToQueue"] as const;

/** GET /api/scheduled-posts?status=scheduled|published|cancelled|failed — default: upcoming. */
export const GET = handler(async (request) => {
  const { businessId } = await requireAnyFeature(...QUEUE_FEATURES);
  const { status } = readQuery(request, scheduledStatusQuery);
  return ok(await listScheduled(businessId, (status?.toUpperCase() ?? "SCHEDULED") as ScheduledPostStatus));
});

/** POST /api/scheduled-posts  { draftId, scheduledFor, mediaUrl? } — schedule a draft. */
export const POST = handler(async (request) => {
  const { businessId, session } = await requireAnyFeature(...QUEUE_FEATURES);
  const { draftId, scheduledFor, mediaUrl } = await readJson(request, createScheduledSchema);
  const draft = await findOwnDraft(businessId, draftId);
  if (draft.status !== "DRAFT") throw new ApiError(409, "conflict", "This draft is already queued, published or rejected.");
  assertFuture(scheduledFor);

  const scheduled = await db.$transaction(async (tx) => {
    await tx.postDraft.update({ where: { id: draftId }, data: { status: "QUEUED", publishError: null } });
    const post = await tx.scheduledPost.create({ data: { businessId, draftId, scheduledFor, mediaUrl: mediaUrl ?? null }, select: SCHEDULED_SELECT });
    await logActivity({ businessId, userId: session.userId, action: "post.queued", details: { draftId, scheduledFor: scheduledFor.toISOString() } }, tx);
    return post;
  });
  const { timezone } = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { timezone: true } });
  return ok(toScheduled(scheduled, timezone, await catalogFor(businessId)), { status: 201 });
});
