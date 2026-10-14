import { getAiStatus } from "@/lib/server/ai-status";
import { requireAnyFeature } from "@/lib/server/guards";
import { handler, ok } from "@/lib/server/http";

/** GET /api/dashboard/ai-status — the AI status card (needs the assistant or recommendations). */
export const GET = handler(async () => {
  const { businessId, permissions } = await requireAnyFeature("assistant", "recommendations");
  return ok(await getAiStatus(businessId, permissions));
});
