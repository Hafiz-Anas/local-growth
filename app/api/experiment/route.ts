import { getExperiment } from "@/lib/server/data";
import { requireFeature } from "@/lib/server/guards";
import { handler, ok } from "@/lib/server/http";

/** GET /api/experiment — the current posting experiment (null if none); sections per enabled feature. */
export const GET = handler(async () => {
  const { businessId, permissions } = await requireFeature("experiment");
  return ok(await getExperiment(businessId, permissions));
});
