import { requireBusiness } from "@/lib/server/guards";
import { handler, ok } from "@/lib/server/http";
import { getOnboardingState } from "@/lib/server/onboarding";

/** GET /api/onboarding — everything the wizard shows, and the step to resume at. */
export const GET = handler(async () => {
  const { businessId, session } = await requireBusiness();
  return ok(await getOnboardingState(businessId, session.userId));
});
