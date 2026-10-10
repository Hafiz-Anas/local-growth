import { db } from "@/lib/db";
import { handler, notFound, ok, readParams } from "@/lib/server/http";
import { requireOnboarding } from "@/lib/server/onboarding";

/** DELETE /api/onboarding/competitors/:id — removes a handle from the step-3 list (any status). */
export const DELETE = handler(async (_request, context: RouteContext<"/api/onboarding/competitors/[id]">) => {
  const { businessId } = await requireOnboarding();
  const { id } = await readParams(context, "id");
  const removed = await db.competitor.deleteMany({ where: { id, businessId } });
  if (removed.count === 0) throw notFound("Competitor");
  return ok({ id });
});
