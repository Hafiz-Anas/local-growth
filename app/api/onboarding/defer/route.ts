import { handler, ok } from "@/lib/server/http";
import { deferOnboarding, requireOnboarding } from "@/lib/server/onboarding";

/** POST /api/onboarding/defer — "Finish later": open the app now; everything entered so far is kept. */
export const POST = handler(async () => {
  const context = await requireOnboarding();
  await deferOnboarding(context);
  return ok({ deferred: true });
});
