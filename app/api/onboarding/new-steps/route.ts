import { requireBusiness } from "@/lib/server/guards";
import { handler, ok } from "@/lib/server/http";
import { skipNewSteps, startNewSteps } from "@/lib/server/onboarding";

/**
 * The one-time prompt for businesses that finished the older wizard.
 * POST — "Complete the new steps": reopens the wizard at its first step (the app stays open).
 * DELETE — "Skip": the prompt doesn't come back.
 */
export const POST = handler(async () => {
  const { businessId, session } = await requireBusiness();
  await startNewSteps(businessId, session.userId);
  return ok({ started: true });
});

export const DELETE = handler(async () => {
  const { businessId } = await requireBusiness();
  await skipNewSteps(businessId);
  return ok({ dismissed: true });
});
