import { requireFeature } from "@/lib/server/guards";
import { handler, ok } from "@/lib/server/http";
import { postPerformance } from "@/lib/server/post-performance";

/** GET /api/post-performance — the last posts compared with each other. */
export const GET = handler(async () => {
  const { businessId } = await requireFeature("postInsights");
  return ok(await postPerformance(businessId));
});
