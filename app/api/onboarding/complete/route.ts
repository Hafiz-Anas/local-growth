import { handler, ok } from "@/lib/server/http";
import { completeOnboarding, requireOnboarding } from "@/lib/server/onboarding";

/** POST /api/onboarding/complete — "Confirm" on the brand-profile screen: onboarding is done. */
export const POST = handler(async () => {
  const context = await requireOnboarding();
  await completeOnboarding(context);
  return ok({ status: "completed" as const });
});
