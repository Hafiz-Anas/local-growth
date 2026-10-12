import { requireAnyFeature } from "@/lib/server/guards";
import { handler, ok, readParams } from "@/lib/server/http";
import { PUBLISH_FEATURES, publishApiError, publishScheduledNow } from "@/lib/server/publishing";

/** Creating the container, waiting for Instagram to process it and publishing can take up to ~1 minute. */
export const maxDuration = 120;

/** POST /api/scheduled-posts/:id/publish — publish a queued post now instead of at its time. */
export const POST = handler(async (_request, context: RouteContext<"/api/scheduled-posts/[id]/publish">) => {
  const { businessId, session } = await requireAnyFeature(...PUBLISH_FEATURES);
  const { id } = await readParams(context, "id");
  const outcome = await publishScheduledNow(businessId, id, session.userId);
  if (!outcome.ok) throw publishApiError(outcome.reason);
  return ok({ published: true, mediaId: outcome.mediaId });
});
