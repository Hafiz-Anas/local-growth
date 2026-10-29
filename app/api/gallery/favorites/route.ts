import { setFavorite } from "@/lib/server/gallery";
import { requireFeature } from "@/lib/server/guards";
import { handler, ok, readJson } from "@/lib/server/http";
import { galleryFavoriteSchema } from "@/lib/validation/api";

/** POST /api/gallery/favorites { ids, value } — adds photos to Favourites or takes them out. */
export const POST = handler(async (request) => {
  const { businessId } = await requireFeature("gallery");
  const { ids, value } = await readJson(request, galleryFavoriteSchema);
  await setFavorite(businessId, ids, value);
  return ok({ ids, value });
});
