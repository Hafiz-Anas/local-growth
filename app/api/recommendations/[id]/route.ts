import { requireFeature } from "@/lib/server/guards";
import { handler, ok, readJson, readParams } from "@/lib/server/http";
import { logActivity } from "@/lib/server/activity";
import { setRecommendationStatus } from "@/lib/server/recommendations";
import { recommendationStatusSchema } from "@/lib/validation/api";

/** PATCH /api/recommendations/:id  { status: "accepted" | "dismissed" | "done" | "new" } — the owner's decision. */
export const PATCH = handler(async (request, context: RouteContext<"/api/recommendations/[id]">) => {
  const { businessId, session } = await requireFeature("recommendations");
  const { id } = await readParams(context, "id");
  const { status } = await readJson(request, recommendationStatusSchema);
  const updated = await setRecommendationStatus(businessId, id, status, session.userId);
  await logActivity({ businessId, userId: session.userId, action: `recommendation.${status}`, details: { id } });
  return ok(updated);
});
