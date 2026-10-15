import { assertCronAuthorized } from "@/lib/server/cron";
import { handler, ok } from "@/lib/server/http";
import { runStatisticsSweep } from "@/lib/server/statistics";

export const maxDuration = 120;

/**
 * GET /api/cron/statistics — only today's follower counts for Statistics (GET /api/cron/daily runs it
 * too). For running it on its own (tests, catching up); not scheduled separately.
 */
export const GET = handler(async (request) => {
  assertCronAuthorized(request, "The statistics job");
  const summary = await runStatisticsSweep(90_000);
  console.info("[cron:statistics]", JSON.stringify(summary));
  return ok(summary);
});
