import { assertCronAuthorized } from "@/lib/server/cron";
import { handler, ok } from "@/lib/server/http";
import { publishDuePosts } from "@/lib/server/publishing";

/** Each post can take up to ~1 minute; the run stops picking new posts after 4 minutes. */
export const maxDuration = 300;

/**
 * GET /api/cron/publish — publishes queued posts whose time has come.
 * Called by Vercel Cron or an external scheduler with `Authorization: Bearer $CRON_SECRET`
 * (Vercel Cron sends that header itself when CRON_SECRET is set). Off until CRON_SECRET is set.
 */
export const GET = handler(async (request) => {
  assertCronAuthorized(request, "Scheduled publishing");
  const summary = await publishDuePosts();
  if (summary.due || summary.recovered) console.info("[cron:publish]", JSON.stringify(summary));
  return ok(summary);
});
