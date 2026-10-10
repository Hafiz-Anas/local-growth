import "server-only";
import { db } from "@/lib/db";
import type { AdminIntegrationDto } from "@/types";
import { needsReconnect } from "./instagram-account";
import { listIntegrationEvents } from "./integration-log";
import { openCredentials } from "./meta-credentials";
import { notFound } from "./http";

/** Admin client page: connection details (token expiry, scopes — never the tokens) and the integration log. */
export async function getAdminIntegration(businessId: string): Promise<AdminIntegrationDto> {
  const business = await db.business.findUnique({
    where: { id: businessId },
    select: {
      instagramConnection: {
        select: {
          provider: true,
          status: true,
          username: true,
          connectedAt: true,
          tokenExpiresAt: true,
          dataAccessExpiresAt: true,
          lastSyncAt: true,
          lastSyncError: true,
          missingPermissions: true,
          credentialsEncrypted: true,
        },
      },
    },
  });
  if (!business) throw notFound("Business");
  const conn = business.instagramConnection;
  const credentials = conn?.provider === "META" ? openCredentials(conn.credentialsEncrypted) : null;
  const status: AdminIntegrationDto["connection"]["status"] =
    !conn || conn.status === "DISCONNECTED" ? "disconnected" : needsReconnect(conn) ? "needs_reconnect" : conn.status === "EXPIRED" ? "expired" : "connected";
  return {
    connection: {
      provider: conn ? (conn.provider === "META" ? "meta" : "mock") : null,
      status,
      username: conn?.username ?? null,
      connectedAt: status === "disconnected" ? null : (conn?.connectedAt?.toISOString() ?? null),
      tokenExpiresAt: conn?.tokenExpiresAt?.toISOString() ?? null,
      tokenExpiresSoon: status !== "disconnected" && Boolean(conn?.tokenExpiresAt && conn.tokenExpiresAt.getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000),
      dataAccessExpiresAt: conn?.dataAccessExpiresAt?.toISOString() ?? null,
      lastSyncAt: conn?.lastSyncAt?.toISOString() ?? null,
      lastSyncError: conn?.lastSyncError ?? null,
      scopes: credentials?.scopes ?? [],
      missingPermissions: status === "disconnected" ? [] : (conn?.missingPermissions ?? []),
      pageName: credentials?.pageName ?? null,
    },
    events: await listIntegrationEvents(businessId, 50),
  };
}
