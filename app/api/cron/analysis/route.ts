import { runAnalysisSweep } from "@/lib/server/analysis-sweep";
import { assertCronAuthorized } from "@/lib/server/cron";
import { handler, ok } from "@/lib/server/http";

export const maxDuration = 300;

/**
 * GET /api/cron/analysis — only the analysis part of the daily job (GET /api/cron/daily runs it too):
 * today's post snapshots, method suggestions for new posts, and the weekly competitor refresh +
 * comparison. For running it on its own (tests, catching up); not scheduled separately.
 */
export const GET = handler(async (request) => {
  assertCronAuthorized(request, "The analysis job");
  const summary = await runAnalysisSweep(240_000);
  console.info("[cron:analysis]", JSON.stringify(summary));
  return ok(summary);
});
