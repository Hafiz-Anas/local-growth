import { restorePhotos } from "@/lib/server/gallery";
import { requireFeature } from "@/lib/server/guards";
import { handler, ok, readJson } from "@/lib/server/http";
import { galleryIdsSchema } from "@/lib/validation/api";

/** POST /api/gallery/restore { ids } — Undo after removing photos. */
export const POST = handler(async (request) => {
  const { businessId } = await requireFeature("gallery");
  const { ids } = await readJson(request, galleryIdsSchema);
  await restorePhotos(businessId, ids);
  return ok({ ids });
});
