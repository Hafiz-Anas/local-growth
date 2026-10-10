import { requireBusiness } from "@/lib/server/guards";
import { ApiError, handler, ok } from "@/lib/server/http";
import { getConnectionDto } from "@/lib/server/instagram-account";
import { syncInstagram } from "@/lib/server/instagram-sync";
import { getRateLimiter, INSTAGRAM_SYNC_LIMIT } from "@/lib/server/rate-limit";

/**
 * POST /api/instagram/sync — "Sync now" (Meta connections): profile, last 50
 * posts, insights and comments. At most once a minute per business.
 */
export const POST = handler(async () => {
  const { businessId } = await requireBusiness();
  const before = await getConnectionDto(businessId);
  if (before.provider !== "meta") throw new ApiError(409, "conflict", "Only accounts connected through Facebook can sync.", [{ path: "provider", message: "not_meta" }]);
  if (before.needsReconnect || before.status === "disconnected") throw new ApiError(409, "instagram_not_connected", "Reconnect Instagram to sync.");

  if (!(await getRateLimiter().consume(INSTAGRAM_SYNC_LIMIT, businessId))) throw new ApiError(429, "rate_limited", "You just synced. Try again in a minute.");

  const result = await syncInstagram(businessId, { scope: "full", reason: "manual" });
  if (result.skipped === "in_progress") throw new ApiError(409, "conflict", "A sync is already running.", [{ path: "sync", message: "in_progress" }]);
  if (result.error === "token_invalid") throw new ApiError(409, "instagram_not_connected", "Reconnect Instagram to sync.");
  if (result.error === "rate_limited") throw new ApiError(429, "rate_limited", "Instagram asked us to slow down. Try again later.");
  return ok({ result, connection: await getConnectionDto(businessId) });
});
