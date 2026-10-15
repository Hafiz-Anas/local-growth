import { assertCronAuthorized } from "@/lib/server/cron";
import { handler, ok } from "@/lib/server/http";
import { runMonitorSweep } from "@/lib/server/monitoring";

export const maxDuration = 300;

/**
 * GET /api/cron/monitor — post monitoring, every hour (`Authorization: Bearer $CRON_SECRET`; on
 * Vercel Hobby from an external scheduler such as cron-job.org, see DEPLOY.md): ends monitors whose
 * time is up (last reading, final numbers, AI summary, notification), then takes the readings that
 * are due. The daily job runs it too, so daily monitoring keeps working without the hourly call.
 */
export const GET = handler(async (request) => {
  assertCronAuthorized(request, "The monitoring job");
  const summary = await runMonitorSweep(240_000);
  console.info("[cron:monitor]", JSON.stringify(summary));
  return ok(summary);
});
