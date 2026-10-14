import "server-only";
import { timingSafeEqual } from "node:crypto";
import { ApiError } from "./http";

/**
 * Cron routes are called by Vercel Cron or an external scheduler with
 * `Authorization: Bearer $CRON_SECRET` (Vercel Cron sends it itself when
 * CRON_SECRET is set). Off (503) until CRON_SECRET is set.
 */
export function assertCronAuthorized(request: Request, what: string): void {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) throw new ApiError(503, "internal_error", `${what} is off: CRON_SECRET is not set.`);
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new ApiError(401, "unauthorized", "Invalid cron secret.");
}
