import { requireFeature } from "@/lib/server/guards";
import { handler, ok } from "@/lib/server/http";
import { explainShareability } from "@/lib/server/shareability";

/** POST /api/shareability/findings — the AI's findings on the most-shared posts, written when missing or a day out of date. */
export const POST = handler(async () => {
  const { businessId } = await requireFeature("postInsights.shareability");
  return ok(await explainShareability(businessId, { from: "page" }));
});
