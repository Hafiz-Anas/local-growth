import { db } from "@/lib/db";
import { requireBusiness } from "@/lib/server/guards";
import { handler, ok } from "@/lib/server/http";

/** DELETE /api/brand/goals/prompt — "Not now" on the one-time goals prompt: it doesn't come back (Settings → Goals still has it). */
export const DELETE = handler(async () => {
  const { businessId } = await requireBusiness();
  await db.business.update({ where: { id: businessId }, data: { goalsPromptDoneAt: new Date() } });
  return ok({ dismissed: true });
});
