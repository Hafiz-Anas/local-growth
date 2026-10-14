import { assertCronAuthorized } from "@/lib/server/cron";
import { handler, ok } from "@/lib/server/http";
import { runRecommendationSweep } from "@/lib/server/recommendations";

/** Each analysis takes a few seconds; the run stops starting new ones after 4 minutes. */
export const maxDuration = 300;

/**
 * GET /api/cron/recommendations — weekly AI recommendations: analyses businesses whose last
 * analysis is at least 7 days old (oldest first, RECOMMENDATIONS_CRON_BATCH per run) and checks
 * the 7-day outcomes of recommendations marked Done. Scheduled daily in vercel.json.
 */
export const GET = handler(async (request) => {
  assertCronAuthorized(request, "Scheduled recommendations");
  const summary = await runRecommendationSweep();
  if (summary.due || summary.outcomes) console.info("[cron:recommendations]", JSON.stringify(summary));
  return ok(summary);
});
