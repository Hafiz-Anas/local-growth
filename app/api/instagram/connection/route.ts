import { z } from "zod";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { logActivity } from "@/lib/server/activity";
import { requireBusiness } from "@/lib/server/guards";
import { ApiError, handler, ok, readJson } from "@/lib/server/http";
import { getConnectionDto } from "@/lib/server/instagram-account";
import { recordError } from "@/lib/server/onboarding";
import { disconnectMeta } from "@/lib/server/meta-connect";
import { getInstagramService } from "@/lib/services/instagram";
import { connectFlow } from "@/lib/services/meta/config";
import { handleSchema } from "@/lib/validation/api";

/** GET /api/instagram/connection — connection status (never the token). */
export const GET = handler(async () => {
  const { businessId } = await requireBusiness();
  return ok(await getConnectionDto(businessId));
});

const connectSchema = z.object({ handle: handleSchema.optional() });

/**
 * POST /api/instagram/connection  { handle? } — connect or reconnect the business's account.
 * `handle` is required while the business has none yet (self sign-ups in
 * onboarding) and may change it until the account is connected.
 * Goes through InstagramService.connectAccount; the mock approves immediately,
 * the real implementation will finish Instagram's OAuth redirect here.
 */
export const POST = handler(async (request) => {
  const { businessId, session } = await requireBusiness();
  // With INSTAGRAM_PROVIDER=meta new connections go through Facebook Login (/api/integrations/instagram/start).
  const flow = connectFlow();
  if (flow === "meta_unavailable") throw new ApiError(503, "instagram_unavailable", "Connecting Instagram is temporarily unavailable.");
  if (flow === "meta") throw new ApiError(409, "conflict", "Connect through Facebook Login.", [{ path: "flow", message: "use_meta" }]);
  // apiFetch only sends a JSON content type when there is a body; reconnects send none.
  const hasBody = (request.headers.get("content-type") ?? "").includes("application/json");
  const { handle: requested } = hasBody ? await readJson(request, connectSchema) : { handle: undefined };
  const business = await db.business.findUniqueOrThrow({
    where: { id: businessId },
    select: { instagramHandle: true, onboardingStatus: true, instagramConnection: { select: { status: true } } },
  });
  const onboarding = business.onboardingStatus === "IN_PROGRESS";

  let handle = business.instagramHandle;
  if (requested && requested !== handle) {
    if (business.instagramConnection?.status === "CONNECTED") {
      throw new ApiError(409, "conflict", "Disconnect the current account before connecting another.", [{ path: "handle", message: "already_connected" }]);
    }
    if (await db.business.count({ where: { instagramHandle: requested, id: { not: businessId } } })) {
      if (onboarding) await recordError(businessId, "instagram", { kind: "connect", reason: "handle_taken" });
      throw new ApiError(409, "conflict", "This Instagram account is already connected to another business.", [{ path: "handle", message: "handle_taken" }]);
    }
    handle = requested;
  }
  if (!handle) throw new ApiError(400, "validation_error", "Enter your Instagram username.", [{ path: "handle", message: "required" }]);

  let account;
  try {
    account = await getInstagramService().connectAccount({ businessId, handle });
  } catch (error) {
    console.error("[instagram] connectAccount failed", error);
    if (onboarding) await recordError(businessId, "instagram", { kind: "connect", reason: "connect_failed" });
    throw new ApiError(502, "instagram_error", "Instagram didn't complete the connection. Try again.");
  }

  const now = new Date();
  const data = {
    provider: "MOCK" as const,
    credentialsEncrypted: null,
    igAccountKey: null,
    missingPermissions: [],
    igUserId: account.igUserId,
    username: account.username,
    accessTokenEncrypted: encrypt(account.accessToken),
    tokenExpiresAt: account.expiresAt,
    status: "CONNECTED" as const,
    connectedAt: now,
    lastSyncAt: now,
  };
  await db.$transaction([
    ...(handle !== business.instagramHandle ? [db.business.update({ where: { id: businessId }, data: { instagramHandle: handle } })] : []),
    db.instagramConnection.upsert({ where: { businessId }, update: data, create: { businessId, ...data } }),
  ]);
  await logActivity({ businessId, userId: session.userId, action: "instagram.connected", details: { username: account.username } });
  return ok(await getConnectionDto(businessId));
});

/** DELETE /api/instagram/connection — disconnect and forget the tokens (mock or Meta). */
export const DELETE = handler(async () => {
  const { businessId, session } = await requireBusiness();
  await disconnectMeta(businessId); // clears every token (mock and Meta) and the account key
  await logActivity({ businessId, userId: session.userId, action: "instagram.disconnected" });
  return ok(await getConnectionDto(businessId));
});
