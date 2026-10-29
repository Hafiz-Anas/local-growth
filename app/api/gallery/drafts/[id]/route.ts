import { deleteDraft, updateDraft } from "@/lib/server/gallery-drafts";
import { requireAnyFeature } from "@/lib/server/guards";
import { handler, ok, readJson, readParams } from "@/lib/server/http";
import { galleryDraftUpdateSchema } from "@/lib/validation/api";

/** PATCH /api/gallery/drafts/:id — edits a draft's caption, hashtags or suggested time (`regenerated` keeps the old caption as a version). */
export const PATCH = handler(async (request, context: RouteContext<"/api/gallery/drafts/[id]">) => {
  const { businessId } = await requireAnyFeature("gallery", "aiChat");
  const { id } = await readParams(context, "id");
  const patch = await readJson(request, galleryDraftUpdateSchema);
  return ok(await updateDraft(businessId, id, patch));
});

/** DELETE /api/gallery/drafts/:id — deletes the draft; its photos stay in the Gallery. */
export const DELETE = handler(async (_request, context: RouteContext<"/api/gallery/drafts/[id]">) => {
  const { businessId } = await requireAnyFeature("gallery", "aiChat");
  const { id } = await readParams(context, "id");
  await deleteDraft(businessId, id);
  return ok({ id });
});
