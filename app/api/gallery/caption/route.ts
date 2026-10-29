import { requireFeature } from "@/lib/server/guards";
import { handler, ok, readJson } from "@/lib/server/http";
import { photoCaption } from "@/lib/server/photo-caption";
import { photoCaptionSchema } from "@/lib/validation/api";

/** POST /api/gallery/caption { photoIds, tone?, request? } — the AI's caption for the owner's photos, or the neutral template. */
export const POST = handler(async (request) => {
  const { businessId } = await requireFeature("aiChat");
  const input = await readJson(request, photoCaptionSchema);
  return ok(await photoCaption(businessId, input));
});
