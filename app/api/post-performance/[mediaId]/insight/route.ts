import { requireFeature } from "@/lib/server/guards";
import { handler, ok, readParams } from "@/lib/server/http";
import { explainPost } from "@/lib/server/post-performance";

/** POST /api/post-performance/:mediaId/insight — the AI's short explanation, written when missing or out of date. */
export const POST = handler(async (_request, context: RouteContext<"/api/post-performance/[mediaId]/insight">) => {
  const { businessId } = await requireFeature("postInsights");
  const { mediaId } = await readParams(context, "mediaId");
  return ok(await explainPost(businessId, mediaId));
});
