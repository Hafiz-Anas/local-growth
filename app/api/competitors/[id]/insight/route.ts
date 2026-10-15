import { explainCompetitor } from "@/lib/server/competitor-analysis";
import { requireFeature } from "@/lib/server/guards";
import { handler, ok, readParams } from "@/lib/server/http";

/**
 * POST /api/competitors/:id/insight — the AI comparison for one competitor, written when missing or out
 * of date. AI unavailable → { status: "unavailable", reason } (the numbers are unaffected);
 * 429 analysis_limit after many requests in an hour.
 */
export const POST = handler(async (_request, context: RouteContext<"/api/competitors/[id]/insight">) => {
  const { businessId } = await requireFeature("competitors.analysis");
  const { id } = await readParams(context, "id");
  return ok(await explainCompetitor(businessId, id));
});
