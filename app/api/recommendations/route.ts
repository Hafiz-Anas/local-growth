import { requireFeature } from "@/lib/server/guards";
import { handler, ok } from "@/lib/server/http";
import { getRecommendations } from "@/lib/server/recommendations";

/** GET /api/recommendations — current recommendations, decisions with outcomes, refresh allowance. */
export const GET = handler(async () => {
  const { businessId } = await requireFeature("recommendations");
  return ok(await getRecommendations(businessId));
});
