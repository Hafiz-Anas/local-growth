import { requireFeature } from "@/lib/server/guards";
import { handler, ok, readQuery } from "@/lib/server/http";
import { explainStatistics } from "@/lib/server/statistics";
import { statisticsQuerySchema } from "@/lib/validation/api";

/** POST /api/statistics/summary?range= — the AI's short summary of the period, written when missing or out of date. */
export const POST = handler(async (request) => {
  const { businessId } = await requireFeature("statistics");
  const { range } = readQuery(request, statisticsQuerySchema);
  return ok(await explainStatistics(businessId, range));
});
