import "server-only";
import { db } from "@/lib/db";
import { enabledFeatureKeys, permissionsFromRows } from "@/lib/permissions";
import type { Session } from "@/types";

/** What the JWT carries: the app session plus the version it was issued for. */
export type SessionClaims = Session & { sessionVersion: number };

/**
 * Loads everything the session carries for a user straight from the database.
 * Returns null when the user no longer exists or is suspended — the caller
 * then ends the session.
 */
export async function loadSessionClaims(userId: string): Promise<SessionClaims | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      avatarUrl: true,
      role: true,
      status: true,
      businessId: true,
      sessionVersion: true,
      business: { select: { permissions: { select: { featureKey: true, enabled: true } } } },
    },
  });
  if (!user || user.status !== "ACTIVE") return null;

  const role = user.role === "ADMIN" ? "admin" : "user";
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    role,
    businessId: user.businessId,
    sessionVersion: user.sessionVersion,
    features: role === "user" && user.business ? enabledFeatureKeys(permissionsFromRows(user.business.permissions)) : [],
  };
}

export type SessionCheck = "revoked" | "stale" | "fresh";

/**
 * Cheap per-request check (one primary-key lookup):
 *  - "revoked": user gone, suspended, or password changed since the token was issued
 *  - "stale":   user row or the business's permissions changed after `refreshedAt`
 *  - "fresh":   nothing to do
 */
export async function checkSession(userId: string, sessionVersion: number, refreshedAt: number): Promise<SessionCheck> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { status: true, sessionVersion: true, updatedAt: true, business: { select: { permissionsUpdatedAt: true } } },
  });
  if (!user || user.status !== "ACTIVE" || user.sessionVersion !== sessionVersion) return "revoked";
  const changedAt = Math.max(user.updatedAt.getTime(), user.business?.permissionsUpdatedAt.getTime() ?? 0);
  return changedAt >= refreshedAt ? "stale" : "fresh";
}
