import { requireFeature } from "@/lib/server/guards";
import { handler, ok, readParams } from "@/lib/server/http";
import { monitorDetail } from "@/lib/server/monitoring";

/** GET /api/monitoring/:id — one monitor: every reading, the account's averages, alerts sent and, once ended, the final numbers. */
export const GET = handler(async (_request, context: RouteContext<"/api/monitoring/[id]">) => {
  const { businessId } = await requireFeature("monitoring");
  const { id } = await readParams(context, "id");
  return ok(await monitorDetail(businessId, id));
});
