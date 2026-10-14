import { getAssistantOverview } from "@/lib/server/assistant";
import { requireFeature } from "@/lib/server/guards";
import { handler, ok } from "@/lib/server/http";

/** GET /api/assistant — available modes, recent chats and today's question allowance. */
export const GET = handler(async () => {
  const { businessId, permissions } = await requireFeature("assistant");
  return ok(await getAssistantOverview(businessId, permissions));
});
