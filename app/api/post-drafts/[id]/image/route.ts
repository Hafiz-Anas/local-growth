import { requireFeature } from "@/lib/server/guards";
import { handler, ok, readParams } from "@/lib/server/http";
import { removeDraftImage, uploadDraftImage } from "@/lib/server/post-images";

/**
 * POST /api/post-drafts/:id/image  (multipart "file": JPG, PNG or WebP up to 8 MB)
 * — the user's own image for the post; replaces an AI-generated one.
 */
export const POST = handler(async (request, context: RouteContext<"/api/post-drafts/[id]/image">) => {
  const { businessId, session } = await requireFeature("postGenerator");
  const { id } = await readParams(context, "id");
  return ok(await uploadDraftImage(businessId, session.userId, id, request));
});

/** DELETE /api/post-drafts/:id/image — remove the image (generated or uploaded). */
export const DELETE = handler(async (_request, context: RouteContext<"/api/post-drafts/[id]/image">) => {
  const { businessId, session } = await requireFeature("postGenerator");
  const { id } = await readParams(context, "id");
  return ok(await removeDraftImage(businessId, session.userId, id));
});
