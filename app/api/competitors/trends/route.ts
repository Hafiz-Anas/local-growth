import { getTrends } from "@/lib/server/data";
import { requireAnyFeature } from "@/lib/server/guards";
import { handler, ok } from "@/lib/server/http";

/** GET /api/competitors/trends — trending audio and/or hashtags, whichever are enabled. */
export const GET = handler(async () => {
  const { businessId, permissions } = await requireAnyFeature("competitors.trendingAudio", "competitors.trendingHashtags");
  return ok(await getTrends(businessId, permissions));
});
