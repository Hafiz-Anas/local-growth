import { createAlbum } from "@/lib/server/gallery";
import { requireFeature } from "@/lib/server/guards";
import { handler, ok, readJson } from "@/lib/server/http";
import { galleryAlbumCreateSchema } from "@/lib/validation/api";

/** POST /api/gallery/albums { name, photoIds?, position? } — a new album (Undo after deleting one puts it back with its photos). */
export const POST = handler(async (request) => {
  const { businessId } = await requireFeature("gallery");
  const input = await readJson(request, galleryAlbumCreateSchema);
  return ok(await createAlbum(businessId, input), { status: 201 });
});
