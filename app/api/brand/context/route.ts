import { stepNumber } from "@/config/onboarding";
import { db } from "@/lib/db";
import { buildBrandContext, currentBrandContext, updateBrandContext } from "@/lib/server/brand";
import { requireBusiness } from "@/lib/server/guards";
import { ApiError, handler, notFound, ok, readJson } from "@/lib/server/http";
import { markBrandBuilt, recordError } from "@/lib/server/onboarding";
import { brandContextPatchSchema } from "@/lib/validation/api";

/** GET /api/brand/context — the current (newest ready) brand context. */
export const GET = handler(async () => {
  const { businessId } = await requireBusiness();
  const context = await currentBrandContext(businessId);
  if (!context) throw notFound("Brand profile");
  return ok(context);
});

/**
 * POST /api/brand/context — build a new version with AIService.buildBrandContext
 * ("Build my brand profile" in onboarding, "Rebuild" in Settings). Older
 * versions are kept. In the wizard a success moves on to the result screen.
 */
export const POST = handler(async () => {
  const { businessId, session } = await requireBusiness();
  const business = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { onboardingStatus: true, onboardingStep: true } });
  const onboarding = business.onboardingStatus === "IN_PROGRESS";
  // In the wizard the profile is built from the Review step (or rebuilt on the result screen).
  if (onboarding && business.onboardingStep < stepNumber("review")) {
    throw new ApiError(400, "validation_error", "Finish the earlier steps first.", [{ path: "step", message: "out_of_order" }]);
  }
  try {
    const context = await buildBrandContext(businessId, session.userId);
    if (onboarding && business.onboardingStep === stepNumber("review")) await markBrandBuilt(businessId, context.version);
    return ok(context, { status: 201 });
  } catch (error) {
    if (onboarding) {
      const details = error instanceof ApiError ? { code: error.code, message: error.message } : { code: "internal_error" };
      await recordError(businessId, "review", { kind: "build_brand_context", ...details });
    }
    throw error;
  }
});

/** PATCH /api/brand/context — edit the current version (summary, styles, purpose cards, colours, tone, words). */
export const PATCH = handler(async (request) => {
  const { businessId, session } = await requireBusiness();
  const patch = await readJson(request, brandContextPatchSchema);
  return ok(await updateBrandContext(businessId, patch, session.userId));
});
