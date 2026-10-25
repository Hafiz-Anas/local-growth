import { requireFeature } from "@/lib/server/guards";
import { handler, ok } from "@/lib/server/http";
import { getShareability } from "@/lib/server/shareability";

/** GET /api/shareability — "Most shared": share rate (shares ÷ reach) per post, the account's average and the cached findings. */
export const GET = handler(async () => {
  const { businessId } = await requireFeature("postInsights.shareability");
  return ok(await getShareability(businessId));
});
