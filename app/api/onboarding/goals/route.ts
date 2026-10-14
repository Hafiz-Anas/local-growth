import { db } from "@/lib/db";
import { handler, ok, readJson } from "@/lib/server/http";
import { getOnboardingState, requireOnboarding } from "@/lib/server/onboarding";
import { goalsSchema } from "@/lib/validation/api";

/** PUT /api/onboarding/goals  { aim, goals, timeline } — the quick chips (all with defaults). */
export const PUT = handler(async (request) => {
  const { businessId, session } = await requireOnboarding();
  const input = await readJson(request, goalsSchema);
  await db.business.update({ where: { id: businessId }, data: { aim: input.aim, goals: [...new Set(input.goals)], timeline: input.timeline } });
  return ok(await getOnboardingState(businessId, session.userId));
});
