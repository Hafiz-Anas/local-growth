import { db } from "@/lib/db";
import { handler, ok, readJson } from "@/lib/server/http";
import { getOnboardingState, requireOnboarding } from "@/lib/server/onboarding";
import { onboardingBrandSchema } from "@/lib/validation/api";

/**
 * PUT /api/onboarding/brand — "Confirm your brand": name, niche, type, tone, hashtags,
 * products and the optional example caption. Saved on Continue (the wizard then moves on).
 */
export const PUT = handler(async (request) => {
  const { businessId, session } = await requireOnboarding();
  const input = await readJson(request, onboardingBrandSchema);
  await db.business.update({
    where: { id: businessId },
    data: {
      name: input.businessName,
      businessType: input.businessType,
      niche: input.niche,
      products: [...new Set(input.products)],
      exampleCaption: input.exampleCaption,
      brandVoice: {
        upsert: {
          create: { toneLevel: input.toneLevel, defaultHashtags: [...new Set(input.hashtags)], brandWords: [], wordsToAvoid: [] },
          update: { toneLevel: input.toneLevel, defaultHashtags: [...new Set(input.hashtags)] },
        },
      },
    },
  });
  return ok(await getOnboardingState(businessId, session.userId));
});
