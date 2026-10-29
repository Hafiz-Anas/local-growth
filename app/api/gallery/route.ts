import { getGallery } from "@/lib/server/gallery";
import { requireAnyFeature } from "@/lib/server/guards";
import { handler, ok } from "@/lib/server/http";

/** GET /api/gallery — the business's photos, albums and drafts (the AI chat picks photos from it too). */
export const GET = handler(async () => {
  const { businessId } = await requireAnyFeature("gallery", "aiChat");
  return ok(await getGallery(businessId));
});
