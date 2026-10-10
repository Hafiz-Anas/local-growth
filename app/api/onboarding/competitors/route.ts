import { logActivity } from "@/lib/server/activity";
import { handler, ok, readJson } from "@/lib/server/http";
import { addOnboardingCompetitor, recordError, requireOnboarding } from "@/lib/server/onboarding";
import { onboardingCompetitorSchema } from "@/lib/validation/api";

/**
 * POST /api/onboarding/competitors  { handle, displayName? }
 * Step 3: adds a handle and validates it with InstagramService.lookupBusinessAccount.
 * Answers 201 with its status (ready, not_business, private, not_found, own_account);
 * only Ready accounts count towards the five needed and appear on Competitor Insights.
 */
export const POST = handler(async (request) => {
  const { businessId, session } = await requireOnboarding();
  let input;
  try {
    input = await readJson(request, onboardingCompetitorSchema);
  } catch (error) {
    await recordError(businessId, "competitors", { kind: "invalid_handle" });
    throw error;
  }
  const competitor = await addOnboardingCompetitor(businessId, input.handle, input.displayName);
  if (competitor.status === "ready") {
    await logActivity({ businessId, userId: session.userId, action: "competitor.added", details: { handle: competitor.handle } });
  }
  return ok(competitor, { status: 201 });
});
