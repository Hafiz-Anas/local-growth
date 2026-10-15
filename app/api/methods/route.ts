import { requireFeature } from "@/lib/server/guards";
import { handler, ok } from "@/lib/server/http";
import { methodsOverview } from "@/lib/server/methods";

/** GET /api/methods — recent posts with their marketing method, the ranking and promoted vs normal (no AI call). */
export const GET = handler(async () => {
  const { businessId, permissions } = await requireFeature("methods");
  return ok(await methodsOverview(businessId, permissions));
});
