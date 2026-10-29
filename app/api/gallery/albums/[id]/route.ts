import { deleteAlbum, renameAlbum } from "@/lib/server/gallery";
import { requireFeature } from "@/lib/server/guards";
import { handler, ok, readJson, readParams } from "@/lib/server/http";
import { galleryAlbumRenameSchema } from "@/lib/validation/api";

/** PATCH /api/gallery/albums/:id { name } — renames an album. */
export const PATCH = handler(async (request, context: RouteContext<"/api/gallery/albums/[id]">) => {
  const { businessId } = await requireFeature("gallery");
  const { id } = await readParams(context, "id");
  const { name } = await readJson(request, galleryAlbumRenameSchema);
  return ok(await renameAlbum(businessId, id, name));
});

/** DELETE /api/gallery/albums/:id — deletes the album; its photos stay in the Gallery. */
export const DELETE = handler(async (_request, context: RouteContext<"/api/gallery/albums/[id]">) => {
  const { businessId } = await requireFeature("gallery");
  const { id } = await readParams(context, "id");
  await deleteAlbum(businessId, id);
  return ok({ id });
});
