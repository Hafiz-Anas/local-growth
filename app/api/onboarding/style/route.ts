import { handler, ok, readJson } from "@/lib/server/http";
import { getOnboardingState, requireOnboarding } from "@/lib/server/onboarding";
import { saveStylePhotos } from "@/lib/server/style-guide";
import { stylePhotosSchema } from "@/lib/validation/api";

/**
 * PUT /api/onboarding/style  { photos: [{ source: "instagram", igMediaId } | { source: "upload", url }] }
 * "Your style": up to 5 picked posts and/or uploads (none = the most recent posts). The AI reads them
 * after the response (the wizard moves on at once) and stores the business's photo style guide.
 */
export const PUT = handler(async (request) => {
  const { businessId, session } = await requireOnboarding();
  const { photos } = await readJson(request, stylePhotosSchema);
  await saveStylePhotos(businessId, photos);
  return ok(await getOnboardingState(businessId, session.userId));
});
