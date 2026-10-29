import { addToAlbum } from "@/lib/server/gallery";
import { requireFeature } from "@/lib/server/guards";
import { handler, ok, readJson, readParams } from "@/lib/server/http";
import { galleryAlbumPhotosSchema } from "@/lib/validation/api";

/** POST /api/gallery/albums/:id/photos { ids, moveFrom? } — adds photos to the album, or moves them from another one. */
export const POST = handler(async (request, context: RouteContext<"/api/gallery/albums/[id]/photos">) => {
  const { businessId } = await requireFeature("gallery");
  const { id } = await readParams(context, "id");
  const { ids, moveFrom } = await readJson(request, galleryAlbumPhotosSchema);
  await addToAlbum(businessId, id, ids, moveFrom);
  return ok({ id, ids });
});
