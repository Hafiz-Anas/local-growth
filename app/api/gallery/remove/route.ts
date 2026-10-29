import { removePhotos } from "@/lib/server/gallery";
import { requireFeature } from "@/lib/server/guards";
import { handler, ok, readJson } from "@/lib/server/http";
import { galleryIdsSchema } from "@/lib/validation/api";

/**
 * POST /api/gallery/remove { ids } — removes photos from the Gallery. Own photos can be put back for a day
 * (POST /api/gallery/restore), then the daily cron deletes their files; Instagram posts are only hidden here.
 */
export const POST = handler(async (request) => {
  const { businessId } = await requireFeature("gallery");
  const { ids } = await readJson(request, galleryIdsSchema);
  await removePhotos(businessId, ids);
  return ok({ ids });
});
