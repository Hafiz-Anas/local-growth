import { competitorAnalysis } from "@/lib/server/competitor-analysis";
import { requireFeature } from "@/lib/server/guards";
import { handler, ok } from "@/lib/server/http";

/** GET /api/competitors/analysis — the business vs each tracked competitor: measured numbers, weekly growth and the cached AI comparison. */
export const GET = handler(async () => {
  const { businessId } = await requireFeature("competitors.analysis");
  return ok(await competitorAnalysis(businessId));
});
