import { isFeatureEnabled } from "@/lib/permissions";
import { requireFeature } from "@/lib/server/guards";
import { handler, ok, readParams } from "@/lib/server/http";
import { postDetail } from "@/lib/server/post-performance";

/** GET /api/post-performance/:mediaId — one post vs the account's average, its daily history, its share rate ("Most shared" on) and the cached AI explanation. */
export const GET = handler(async (_request, context: RouteContext<"/api/post-performance/[mediaId]">) => {
  const { businessId, permissions } = await requireFeature("postInsights");
  const { mediaId } = await readParams(context, "mediaId");
  return ok(await postDetail(businessId, mediaId, { shareability: isFeatureEnabled(permissions, "postInsights.shareability") }));
});
