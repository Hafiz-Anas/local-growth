import { getDashboard } from "@/lib/server/data";
import { requireBusiness } from "@/lib/server/guards";
import { handler, ok } from "@/lib/server/http";

/** GET /api/dashboard — summary for the home screen; sections only for enabled dashboard features. */
export const GET = handler(async () => {
  const { businessId, permissions } = await requireBusiness();
  return ok(await getDashboard(businessId, permissions));
});
