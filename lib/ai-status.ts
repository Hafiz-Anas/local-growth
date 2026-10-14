import type { AiStatusDto } from "@/types";

/**
 * The AI status card's rules: the connection's health and what needs attention.
 * Pure (shared shape with the stored connection) so it can be unit-tested.
 */

/** Synced data older than this shows a "data may be out of date" warning (auto-sync runs after 6 h). */
export const STALE_SYNC_MS = 24 * 60 * 60 * 1000;

export interface ConnectionState {
  provider: "MOCK" | "META";
  status: "CONNECTED" | "EXPIRED" | "DISCONNECTED" | "NEEDS_RECONNECT";
  tokenExpiresAt: Date | null;
  lastSyncAt: Date | null;
  lastSyncError: string | null;
  missingPermissions: string[];
}

export function aiStatusHealth(conn: ConnectionState | null, now = new Date()): Pick<AiStatusDto["account"], "health"> & { warnings: AiStatusDto["warnings"] } {
  if (!conn || conn.status === "DISCONNECTED") return { health: "disconnected", warnings: ["not_connected"] };
  if (conn.provider === "MOCK") return conn.status === "CONNECTED" ? { health: "demo", warnings: [] } : { health: "needs_reconnect", warnings: ["reconnect"] };
  const expired = conn.status === "NEEDS_RECONNECT" || conn.status === "EXPIRED" || Boolean(conn.tokenExpiresAt && conn.tokenExpiresAt <= now);
  if (expired) return { health: "needs_reconnect", warnings: ["reconnect"] };
  if (conn.missingPermissions.length) return { health: "permissions", warnings: ["permissions"] };
  const warnings: AiStatusDto["warnings"] = [];
  if (!conn.lastSyncAt || now.getTime() - conn.lastSyncAt.getTime() > STALE_SYNC_MS) warnings.push("stale");
  if (conn.lastSyncError) warnings.push("sync_failed");
  return { health: "healthy", warnings };
}
