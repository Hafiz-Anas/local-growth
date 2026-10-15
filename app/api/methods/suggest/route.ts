import { requireFeature } from "@/lib/server/guards";
import { handler, ok } from "@/lib/server/http";
import { methodsOverview } from "@/lib/server/methods";

/** POST /api/methods/suggest — the AI suggests methods for posts only the caption rules have seen (one call, rate-limited). */
export const POST = handler(async () => {
  const { businessId, permissions } = await requireFeature("methods");
  return ok(await methodsOverview(businessId, permissions, { useAi: true }));
});
