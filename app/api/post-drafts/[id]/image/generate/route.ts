import { requireFeature } from "@/lib/server/guards";
import { handler, ok, readParams } from "@/lib/server/http";
import { generateDraftImage } from "@/lib/server/post-images";

/**
 * POST /api/post-drafts/:id/image/generate — an AI image (IMAGE_PROVIDER) from
 * the brand profile, the caption and the post's purpose; replaces any image.
 * Provider failures (quota, billing, key, safety) come back as 429/422/503
 * "image_unavailable" with the reason in details — never a 500. Never publishes.
 */
export const POST = handler(async (_request, context: RouteContext<"/api/post-drafts/[id]/image/generate">) => {
  const { businessId, session } = await requireFeature("postGenerator");
  const { id } = await readParams(context, "id");
  return ok(await generateDraftImage(businessId, session.userId, id));
});
