import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { ApiError, handler, ok, readJson } from "@/lib/server/http";
import { getOnboardingState, recordError, requireOnboarding } from "@/lib/server/onboarding";
import { businessProfileSchema } from "@/lib/validation/api";

/**
 * PUT /api/onboarding/business — step 2 (business type, location, description,
 * products, audience). The posting language isn't asked: lib/server/brand.ts
 * learns it from the captions when the brand profile is built. Saved on Continue; the wizard then moves on.
 */
export const PUT = handler(async (request) => {
  const { businessId, session } = await requireOnboarding();
  let input;
  try {
    input = await readJson(request, businessProfileSchema);
  } catch (error) {
    const fields = error instanceof ApiError && Array.isArray(error.details) ? (error.details as Prisma.InputJsonArray) : [];
    await recordError(businessId, "business", { kind: "validation", fields });
    throw error;
  }
  await db.business.update({
    where: { id: businessId },
    data: {
      businessType: input.businessType,
      businessTypeOther: input.businessType === "other" ? input.businessTypeOther : null,
      location: input.location,
      description: input.description,
      products: [...new Set(input.products)],
      targetAudience: input.targetAudience,
    },
  });
  return ok(await getOnboardingState(businessId, session.userId));
});
