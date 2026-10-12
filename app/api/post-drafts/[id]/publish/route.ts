import { requireFeature } from "@/lib/server/guards";
import { handler, ok, readParams } from "@/lib/server/http";
import { publishApiError, publishDraftNow } from "@/lib/server/publishing";

/** Creating the container, waiting for Instagram to process it and publishing can take up to ~1 minute. */
export const maxDuration = 120;

/** POST /api/post-drafts/:id/publish — publish the draft to Instagram now (a queued draft leaves the queue). */
export const POST = handler(async (_request, context: RouteContext<"/api/post-drafts/[id]/publish">) => {
  const { businessId, session } = await requireFeature("postGenerator.addToQueue");
  const { id } = await readParams(context, "id");
  const outcome = await publishDraftNow(businessId, id, session.userId);
  if (!outcome.ok) throw publishApiError(outcome.reason);
  return ok({ published: true, mediaId: outcome.mediaId });
});
