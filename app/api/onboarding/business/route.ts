import { db } from "@/lib/db";
import { handler, ok, readJson } from "@/lib/server/http";
import { getOnboardingState, requireOnboarding } from "@/lib/server/onboarding";
import { onboardingBusinessSchema } from "@/lib/validation/api";

/**
 * PUT /api/onboarding/business — "Your business": type, tone, hashtags and the main products or menu
 * categories (pre-filled by the AI, confirmed or edited), plus the optional example caption.
 * Saved on Continue (the wizard then moves on); "Skip" saves nothing.
 */
export const PUT = handler(async (request) => {
  const { businessId, session } = await requireOnboarding();
  const input = await readJson(request, onboardingBusinessSchema);
  const hashtags = [...new Set(input.hashtags)];
  await db.business.update({
    where: { id: businessId },
    data: {
      businessType: input.businessType,
      products: [...new Set(input.products)],
      ...(input.exampleCaption !== undefined && { exampleCaption: input.exampleCaption }),
      brandVoice: {
        upsert: {
          create: { toneLevel: input.toneLevel, defaultHashtags: hashtags, brandWords: [], wordsToAvoid: [] },
          update: { toneLevel: input.toneLevel, defaultHashtags: hashtags },
        },
      },
    },
  });
  return ok(await getOnboardingState(businessId, session.userId));
});
