import "server-only";
import { decrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
import type { InstagramAccount } from "@/lib/services/instagram";
import { connectFlow } from "@/lib/services/meta/config";
import type { ConnectionStatus, InstagramConnectionDto } from "@/types";
import { openCredentials } from "./meta-credentials";

/** Tokens expiring within this window show as "needs attention". */
const EXPIRY_WARNING_MS = 7 * 24 * 60 * 60 * 1000;
/** A sync marked as running longer than this is considered dead. */
export const SYNC_STALE_MS = 10 * 60 * 1000;

interface ConnectionRow {
  status: "CONNECTED" | "EXPIRED" | "DISCONNECTED" | "NEEDS_RECONNECT";
  tokenExpiresAt: Date | null;
}

/** DB connection → the UI's three states. */
export function connectionStatusOf(conn: ConnectionRow | null | undefined): ConnectionStatus {
  if (!conn || conn.status === "DISCONNECTED") return "disconnected";
  if (conn.status === "EXPIRED" || conn.status === "NEEDS_RECONNECT") return "needs_attention";
  if (conn.tokenExpiresAt && conn.tokenExpiresAt.getTime() - Date.now() < EXPIRY_WARNING_MS) return "needs_attention";
  return "connected";
}

/** The connection needs the user to log in again (revoked/expired token, or past its expiry). */
export function needsReconnect(conn: (ConnectionRow & { provider: "MOCK" | "META" }) | null | undefined): boolean {
  if (!conn || conn.provider !== "META" || conn.status === "DISCONNECTED") return false;
  return conn.status === "NEEDS_RECONNECT" || conn.status === "EXPIRED" || Boolean(conn.tokenExpiresAt && conn.tokenExpiresAt <= new Date());
}

/**
 * The account Instagram calls act for, with the token decrypted (server only).
 * Meta connections act with the Page token on the Instagram business account.
 */
export async function getInstagramAccount(businessId: string): Promise<InstagramAccount> {
  const business = await db.business.findUniqueOrThrow({
    where: { id: businessId },
    select: {
      instagramHandle: true,
      instagramConnection: {
        select: { provider: true, status: true, igUserId: true, username: true, accessTokenEncrypted: true, credentialsEncrypted: true, tokenExpiresAt: true },
      },
    },
  });
  const conn = business.instagramConnection;
  const unexpired = !conn?.tokenExpiresAt || conn.tokenExpiresAt > new Date();
  const username = conn?.username ?? business.instagramHandle ?? "";

  if (conn?.provider === "META") {
    const credentials = conn.status === "CONNECTED" && unexpired ? openCredentials(conn.credentialsEncrypted) : null;
    return { businessId, provider: "meta", igUserId: credentials?.igUserId ?? null, username, accessToken: credentials?.pageToken ?? null, connected: Boolean(credentials) };
  }

  const usable = conn?.status === "CONNECTED" && Boolean(conn.accessTokenEncrypted) && unexpired;
  return {
    businessId,
    provider: "mock",
    igUserId: conn?.igUserId ?? null,
    username,
    accessToken: usable && conn?.accessTokenEncrypted ? decrypt(conn.accessTokenEncrypted) : null,
    connected: usable,
  };
}

/** Short, safe sync failure reasons stored in lastSyncError (never raw Meta messages). */
export type SyncErrorCode = "token_invalid" | "permission" | "rate_limited" | "transient" | "failed";

/** Connection status for the UI — never includes a token. */
export async function getConnectionDto(businessId: string): Promise<InstagramConnectionDto> {
  const conn = await db.instagramConnection.findUnique({
    where: { businessId },
    select: {
      status: true,
      provider: true,
      username: true,
      tokenExpiresAt: true,
      lastSyncAt: true,
      connectedAt: true,
      missingPermissions: true,
      syncStartedAt: true,
      lastSyncError: true,
    },
  });
  const active = conn && conn.status !== "DISCONNECTED";
  return {
    status: connectionStatusOf(conn),
    username: conn?.username ?? null,
    connectedAt: active ? (conn.connectedAt?.toISOString() ?? null) : null,
    tokenExpiresAt: conn?.tokenExpiresAt?.toISOString() ?? null,
    lastSyncAt: conn?.lastSyncAt?.toISOString() ?? null,
    provider: conn ? (conn.provider === "META" ? "meta" : "mock") : null,
    flow: connectFlow(),
    needsReconnect: needsReconnect(conn),
    missingPermissions: active ? conn.missingPermissions : [],
    syncing: Boolean(conn?.syncStartedAt && Date.now() - conn.syncStartedAt.getTime() < SYNC_STALE_MS),
    lastSyncError: active ? conn.lastSyncError : null,
  };
}
