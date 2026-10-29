import { receiveLocalUpload } from "@/lib/server/gallery-uploads";
import { requireAnyFeature } from "@/lib/server/guards";
import { handler, ok, readParams } from "@/lib/server/http";

/** PUT /api/gallery/uploads/:id (multipart "file") — local storage only (development, e2e): stores the photo. */
export const PUT = handler(async (request, context: RouteContext<"/api/gallery/uploads/[id]">) => {
  const { businessId } = await requireAnyFeature("gallery", "aiChat");
  const { id } = await readParams(context, "id");
  return ok(await receiveLocalUpload(businessId, id, request));
});
