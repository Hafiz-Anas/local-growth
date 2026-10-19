import { saveLocation } from "@/lib/server/business-details";
import { handler, ok, readJson } from "@/lib/server/http";
import { getOnboardingState, requireOnboarding } from "@/lib/server/onboarding";
import { locationSchema } from "@/lib/validation/api";

/** PUT /api/onboarding/location  { governorate, area, serviceMode } — "Your location" in Kuwait (config/kuwait.ts). */
export const PUT = handler(async (request) => {
  const { businessId, session } = await requireOnboarding();
  await saveLocation(businessId, await readJson(request, locationSchema));
  return ok(await getOnboardingState(businessId, session.userId));
});
