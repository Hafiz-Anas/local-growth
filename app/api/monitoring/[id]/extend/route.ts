import { requireFeature } from "@/lib/server/guards";
import { handler, ok, readJson, readParams } from "@/lib/server/http";
import { extendMonitor } from "@/lib/server/monitoring";
import { monitorExtendSchema } from "@/lib/validation/api";

/** POST /api/monitoring/:id/extend  { duration } — monitors longer (from the current end; at most a year from now). */
export const POST = handler(async (request, context: RouteContext<"/api/monitoring/[id]/extend">) => {
  const { businessId, session } = await requireFeature("monitoring");
  const { id } = await readParams(context, "id");
  const { duration } = await readJson(request, monitorExtendSchema);
  return ok(await extendMonitor({ businessId, userId: session.userId }, id, duration));
});
