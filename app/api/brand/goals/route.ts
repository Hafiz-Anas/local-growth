import { db } from "@/lib/db";
import { requireBusiness } from "@/lib/server/guards";
import { handler, ok, readJson } from "@/lib/server/http";
import { goalsSchema } from "@/lib/validation/api";

/** GET /api/brand/goals — niche, aim, goals and timeline (Settings → Goals). */
export const GET = handler(async () => {
  const { businessId } = await requireBusiness();
  return ok(await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { niche: true, aim: true, goals: true, timeline: true } }));
});

/** PUT /api/brand/goals  { aim, goals, timeline, niche? } — Settings → Goals and the one-time prompt (which it closes). */
export const PUT = handler(async (request) => {
  const { businessId } = await requireBusiness();
  const input = await readJson(request, goalsSchema);
  return ok(
    await db.business.update({
      where: { id: businessId },
      data: { aim: input.aim, goals: [...new Set(input.goals)], timeline: input.timeline, ...(input.niche !== undefined && { niche: input.niche }), goalsPromptDoneAt: new Date() },
      select: { niche: true, aim: true, goals: true, timeline: true },
    }),
  );
});
