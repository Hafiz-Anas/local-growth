import { requireFeature } from "@/lib/server/guards";
import { handler, ok } from "@/lib/server/http";
import { insightsOverview } from "@/lib/server/insights-overview";

/** GET /api/insights/overview — the last 7 days vs the 7 before: three key numbers and a summary. */
export const GET = handler(async () => {
  const { businessId } = await requireFeature("postInsights");
  return ok(await insightsOverview(businessId));
});
