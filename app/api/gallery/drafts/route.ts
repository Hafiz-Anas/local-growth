import { createDraft } from "@/lib/server/gallery-drafts";
import { requireAnyFeature } from "@/lib/server/guards";
import { handler, ok, readJson } from "@/lib/server/http";
import { galleryDraftCreateSchema } from "@/lib/validation/api";

/** POST /api/gallery/drafts — saves a post (photos, EN/AR caption, hashtags, suggested time) as a draft. Nothing is published. */
export const POST = handler(async (request) => {
  const { businessId, session } = await requireAnyFeature("gallery", "aiChat");
  const input = await readJson(request, galleryDraftCreateSchema);
  return ok(await createDraft(businessId, session.userId, input), { status: 201 });
});
