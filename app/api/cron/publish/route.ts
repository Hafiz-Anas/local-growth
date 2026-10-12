import { timingSafeEqual } from "node:crypto";
import { ApiError, handler, ok } from "@/lib/server/http";
import { publishDuePosts } from "@/lib/server/publishing";

/** Each post can take up to ~1 minute; the run stops picking new posts after 4 minutes. */
export const maxDuration = 300;

function authorized(request: Request, secret: string): boolean {
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * GET /api/cron/publish — publishes queued posts whose time has come.
 * Called by Vercel Cron or an external scheduler with `Authorization: Bearer $CRON_SECRET`
 * (Vercel Cron sends that header itself when CRON_SECRET is set). Off until CRON_SECRET is set.
 */
export const GET = handler(async (request) => {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) throw new ApiError(503, "internal_error", "Scheduled publishing is off: CRON_SECRET is not set.");
  if (!authorized(request, secret)) throw new ApiError(401, "unauthorized", "Invalid cron secret.");
  const summary = await publishDuePosts();
  if (summary.due || summary.recovered) console.info("[cron:publish]", JSON.stringify(summary));
  return ok(summary);
});
