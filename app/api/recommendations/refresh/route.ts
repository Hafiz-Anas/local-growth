import { isFeatureEnabled } from "@/lib/permissions";
import { requireFeature } from "@/lib/server/guards";
import { handler, ok } from "@/lib/server/http";
import { getRecommendations, refreshRecommendations } from "@/lib/server/recommendations";

/** An analysis can take up to a minute. */
export const maxDuration = 90;

/**
 * POST /api/recommendations/refresh — analyse now. `unchanged` when the data and decisions
 * haven't changed since the last analysis (no AI call, doesn't count toward the daily limit).
 * 429 recommendations_limit, 503 recommendations_unavailable (nothing changes), 409 instagram_not_connected.
 */
export const POST = handler(async () => {
  const { businessId, session, permissions } = await requireFeature("recommendations");
  const result = await refreshRecommendations(businessId, session.userId, isFeatureEnabled(permissions, "competitors"));
  return ok({ result, data: await getRecommendations(businessId) });
});
