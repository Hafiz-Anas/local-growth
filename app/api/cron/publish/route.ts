import { assertCronAuthorized } from "@/lib/server/cron";
import { handler, ok } from "@/lib/server/http";
import { publishDuePosts } from "@/lib/server/publishing";

/** One run works on due jobs for up to 4 minutes (each job up to 45 s, then the next run continues it). */
export const maxDuration = 300;

/**
 * GET /api/cron/publish — works through the publishing jobs (lib/server/publishing.ts): due posts, retries,
 * containers still processing. Meant to run every minute (DEPLOY.md: cron-job.org).
 * Called by Vercel Cron or an external scheduler with `Authorization: Bearer $CRON_SECRET`
 * (Vercel Cron sends that header itself when CRON_SECRET is set). Off until CRON_SECRET is set.
 */
export const GET = handler(async (request) => {
  assertCronAuthorized(request, "Scheduled publishing");
  const summary = await publishDuePosts();
  if (summary.due) console.info("[cron:publish]", JSON.stringify(summary));
  return ok(summary);
});
