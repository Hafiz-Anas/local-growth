import { handler, ok, readJson } from "@/lib/server/http";
import { getOnboardingState, moveToStep, requireOnboarding } from "@/lib/server/onboarding";
import { onboardingProgressSchema } from "@/lib/validation/api";

/**
 * POST /api/onboarding/progress  { step, direction: "forward" | "back" | "jump", details? }
 * Moves the wizard (saved, so logging in again resumes here). Forward moves
 * are refused while the current step is incomplete.
 */
export const POST = handler(async (request) => {
  const context = await requireOnboarding();
  const { step, direction, details } = await readJson(request, onboardingProgressSchema);
  await moveToStep(context, step, direction, details);
  return ok(await getOnboardingState(context.businessId, context.session.userId));
});
