import { requireFeature } from "@/lib/server/guards";
import { handler, ok, readParams } from "@/lib/server/http";
import { stopMonitor } from "@/lib/server/monitoring";

/** POST /api/monitoring/:id/stop — stops now; the final numbers are kept in the history (the AI summary follows). */
export const POST = handler(async (_request, context: RouteContext<"/api/monitoring/[id]/stop">) => {
  const { businessId, session } = await requireFeature("monitoring");
  const { id } = await readParams(context, "id");
  return ok(await stopMonitor({ businessId, userId: session.userId }, id));
});
