import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { readTargets } from "@/lib/onboarding-answers";
import { requireBusiness } from "@/lib/server/guards";
import { handler, ok, readJson } from "@/lib/server/http";
import { goalsSchema } from "@/lib/validation/api";
import type { Feeling } from "@/types";

const GOALS_SELECT = { niche: true, aim: true, goals: true, timeline: true, targets: true, feelings: true, feelingOther: true } satisfies Prisma.BusinessSelect;

const toGoals = (row: Prisma.BusinessGetPayload<{ select: typeof GOALS_SELECT }>) => ({ ...row, targets: readTargets(row.targets), feelings: row.feelings as Feeling[] });

/** GET /api/brand/goals — niche, aim, goals, timeline, and onboarding's targets and feeling (Settings → Goals). */
export const GET = handler(async () => {
  const { businessId } = await requireBusiness();
  return ok(toGoals(await db.business.findUniqueOrThrow({ where: { id: businessId }, select: GOALS_SELECT })));
});

/**
 * PUT /api/brand/goals  { aim, goals, timeline, niche?, targets?, feelings?, feelingOther? } — Settings → Goals
 * and the one-time prompt (which it closes).
 */
export const PUT = handler(async (request) => {
  const { businessId } = await requireBusiness();
  const input = await readJson(request, goalsSchema);
  const row = await db.business.update({
    where: { id: businessId },
    data: {
      aim: input.aim,
      goals: [...new Set(input.goals)],
      timeline: input.timeline,
      ...(input.niche !== undefined && { niche: input.niche }),
      ...(input.targets && { targets: input.targets as unknown as Prisma.InputJsonArray }),
      ...(input.feelings && { feelings: [...new Set(input.feelings)] }),
      ...(input.feelingOther !== undefined && { feelingOther: input.feelingOther }),
      goalsPromptDoneAt: new Date(),
    },
    select: GOALS_SELECT,
  });
  return ok(toGoals(row));
});
