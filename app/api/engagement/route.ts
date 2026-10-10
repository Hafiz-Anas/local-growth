import { getEngagement } from "@/lib/server/data";
import { requireFeature } from "@/lib/server/guards";
import { handler, ok } from "@/lib/server/http";

/** GET /api/engagement — today's stats and the engagement settings the business may see. */
export const GET = handler(async () => {
  const { businessId, permissions } = await requireFeature("engagement");
  return ok(await getEngagement(businessId, permissions));
});
