import { requireFeature } from "@/lib/server/guards";
import { handler, ok, readQuery } from "@/lib/server/http";
import { getStatistics } from "@/lib/server/statistics";
import { statisticsQuerySchema } from "@/lib/validation/api";

/** GET /api/statistics?range=7d|30d|90d|1y — account numbers over the period, computed in code, with the cached AI summary. */
export const GET = handler(async (request) => {
  const { businessId } = await requireFeature("statistics");
  const { range } = readQuery(request, statisticsQuerySchema);
  return ok(await getStatistics(businessId, range));
});
