import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { handler, ok, readJson } from "@/lib/server/http";
import { getOnboardingState, requireOnboarding } from "@/lib/server/onboarding";
import { onboardingGoalsSchema } from "@/lib/validation/api";

/**
 * PUT /api/onboarding/goals  { targets: [{ key, number? }], feelings, feelingOther }
 * "Your goals": what they want more of (an optional number each) and how posts should feel.
 */
export const PUT = handler(async (request) => {
  const { businessId, session } = await requireOnboarding();
  const input = await readJson(request, onboardingGoalsSchema);
  await db.business.update({
    where: { id: businessId },
    data: { targets: input.targets as unknown as Prisma.InputJsonArray, feelings: [...new Set(input.feelings)], feelingOther: input.feelingOther },
  });
  return ok(await getOnboardingState(businessId, session.userId));
});
