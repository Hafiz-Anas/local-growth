import { runAnalysisSweep } from "@/lib/server/analysis-sweep";
import { assertCronAuthorized } from "@/lib/server/cron";
import { handler, ok } from "@/lib/server/http";
import { runMonitorSweep } from "@/lib/server/monitoring";
import { notifyReconnectsNeeded } from "@/lib/server/notifications";
import { runRecommendationSweep } from "@/lib/server/recommendations";
import { runReportSweep } from "@/lib/server/reports";

/** The run stops starting new work after about 4 minutes; the rest waits for tomorrow. */
export const maxDuration = 300;
const BUDGET_MS = 240_000;

/**
 * GET /api/cron/daily — the daily job (scheduled in vercel.json, `Authorization: Bearer $CRON_SECRET`):
 * reconnect alerts, then weekly reports, then weekly recommendations for the businesses that are due,
 * then the analysis: daily post snapshots, post methods, weekly competitor snapshots and comparisons,
 * then post monitoring (daily readings and monitors that ended).
 * AI calls are spaced to GEMINI_TEXT_RPM and go through the same daily budget as everything else.
 */
export const GET = handler(async (request) => {
  assertCronAuthorized(request, "The daily job");
  const started = Date.now();
  const reconnects = await notifyReconnectsNeeded();
  const reports = await runReportSweep(Math.min(120_000, BUDGET_MS - (Date.now() - started)));
  const recommendations = await runRecommendationSweep(Math.max(0, Math.min(90_000, BUDGET_MS - (Date.now() - started))));
  const analysis = await runAnalysisSweep(Math.max(0, BUDGET_MS - (Date.now() - started)));
  // Post monitoring also runs hourly (GET /api/cron/monitor); here it keeps daily monitors going without that.
  const monitoring = await runMonitorSweep(Math.max(0, BUDGET_MS - (Date.now() - started)));
  const summary = { reconnects, reports, recommendations, analysis, monitoring };
  console.info("[cron:daily]", JSON.stringify(summary));
  return ok(summary);
});
