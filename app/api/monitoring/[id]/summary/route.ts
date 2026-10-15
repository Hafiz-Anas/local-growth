import { requireFeature } from "@/lib/server/guards";
import { handler, ok, readParams } from "@/lib/server/http";
import { requestSummary } from "@/lib/server/monitoring";

/** POST /api/monitoring/:id/summary — the AI summary of an ended monitor, written again when it couldn't be before. */
export const POST = handler(async (_request, context: RouteContext<"/api/monitoring/[id]/summary">) => {
  const { businessId } = await requireFeature("monitoring");
  const { id } = await readParams(context, "id");
  return ok(await requestSummary(businessId, id));
});
