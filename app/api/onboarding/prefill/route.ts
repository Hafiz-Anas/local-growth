import { handler, ok, readJson } from "@/lib/server/http";
import { getOnboardingState, requireOnboarding } from "@/lib/server/onboarding";
import { prefillBrand } from "@/lib/server/onboarding-prefill";
import { prefillSchema } from "@/lib/validation/api";

/** An AI call that can take a while; the wizard shows the fields meanwhile and carries on without it. */
export const maxDuration = 60;

/**
 * POST /api/onboarding/prefill  { locale } — suggestions for "Confirm your brand" from the
 * Instagram bio and recent posts (once; stored). Never fails because of the AI: without it
 * the suggestions are just emptier.
 */
export const POST = handler(async (request) => {
  const { businessId, session } = await requireOnboarding();
  const { locale } = await readJson(request, prefillSchema);
  await prefillBrand(businessId, locale);
  return ok(await getOnboardingState(businessId, session.userId));
});
