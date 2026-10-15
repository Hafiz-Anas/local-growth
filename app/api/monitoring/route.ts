import { requireFeature } from "@/lib/server/guards";
import { handler, ok, readJson } from "@/lib/server/http";
import { monitoringOverview, startMonitor } from "@/lib/server/monitoring";
import { monitorStartSchema } from "@/lib/validation/api";

/** GET /api/monitoring — monitored posts (with a mini chart each), the plan's limit and the history. */
export const GET = handler(async () => {
  const { businessId } = await requireFeature("monitoring");
  return ok(await monitoringOverview(businessId));
});

/** POST /api/monitoring  { igMediaId, duration } — "Monitor this post": starts and takes the first reading. */
export const POST = handler(async (request) => {
  const { businessId, session } = await requireFeature("monitoring");
  const { igMediaId, duration } = await readJson(request, monitorStartSchema);
  return ok(await startMonitor({ businessId, userId: session.userId }, igMediaId, duration), { status: 201 });
});
