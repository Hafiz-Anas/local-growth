import { completeUpload } from "@/lib/server/gallery-uploads";
import { requireAnyFeature } from "@/lib/server/guards";
import { handler, ok, readJson, readParams } from "@/lib/server/http";
import { galleryUploadCompleteSchema } from "@/lib/validation/api";

/** POST /api/gallery/uploads/:id/complete { url } — checks the stored photo and adds it to the Gallery (422 upload_invalid otherwise). */
export const POST = handler(async (request, context: RouteContext<"/api/gallery/uploads/[id]/complete">) => {
  const { businessId, session } = await requireAnyFeature("gallery", "aiChat");
  const { id } = await readParams(context, "id");
  const { url } = await readJson(request, galleryUploadCompleteSchema);
  return ok(await completeUpload(businessId, session.userId, id, url), { status: 201 });
});
