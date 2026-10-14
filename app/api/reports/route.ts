import { requireFeature } from "@/lib/server/guards";
import { handler, ok } from "@/lib/server/http";
import { listReports } from "@/lib/server/reports";

/** GET /api/reports — the business's weekly reports, newest first. */
export const GET = handler(async () => {
  const { businessId } = await requireFeature("reports");
  return ok(await listReports(businessId));
});
