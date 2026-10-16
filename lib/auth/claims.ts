import "server-only";
import { resolveActiveAccount } from "@/lib/accounts";
import { db } from "@/lib/db";
import { enabledFeatureKeys, permissionsFromRows } from "@/lib/permissions";
import type { Session } from "@/types";

/** What the JWT carries: the app session plus the version it was issued for. */
export type SessionClaims = Session & { sessionVersion: number };

/**
 * Loads everything the session carries for a user straight from the database.
 * Returns null when the user no longer exists or is suspended — the caller
 * then ends the session.
 *
 * `businessId` is the active Instagram account: the saved one (User.businessId) only when the
 * user is still a member of it; otherwise their oldest account, which is then saved.
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
      memberships: { select: { businessId: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!user || user.status !== "ACTIVE") return null;

  const role = user.role === "ADMIN" ? "admin" : "user";
  const businessId = role === "user" ? resolveActiveAccount(user.businessId, user.memberships.map((m) => m.businessId)) : null;
  if (role === "user" && businessId !== user.businessId) {
    await db.user.update({ where: { id: user.id }, data: { businessId } });
  }
  const business = businessId
    ? await db.business.findUnique({ where: { id: businessId }, select: { permissions: { select: { featureKey: true, enabled: true } } } })
    : null;
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    role,
    businessId,
    sessionVersion: user.sessionVersion,
    features: role === "user" && business ? enabledFeatureKeys(permissionsFromRows(business.permissions)) : [],
  };
}

export type SessionCheck = "revoked" | "stale" | "fresh";

/**
 * Cheap per-request check (one primary-key lookup):
 *  - "revoked": user gone, suspended, or password changed since the token was issued
 *  - "stale":   the token's active account isn't the saved one, or the user no longer belongs
 *               to it (claims are reloaded before this request uses them), or the user row or
 *               the account's permissions changed after `refreshedAt`
 *  - "fresh":   nothing to do
 */
export async function checkSession(userId: string, sessionVersion: number, refreshedAt: number, businessId: string | null): Promise<SessionCheck> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      status: true,
      sessionVersion: true,
      updatedAt: true,
      businessId: true,
      business: { select: { permissionsUpdatedAt: true } },
      memberships: { where: { businessId: businessId ?? "" }, select: { id: true } },
    },
  });
  if (!user || user.status !== "ACTIVE" || user.sessionVersion !== sessionVersion) return "revoked";
  if (user.businessId !== businessId || (businessId && user.memberships.length === 0)) return "stale";
  const changedAt = Math.max(user.updatedAt.getTime(), user.business?.permissionsUpdatedAt.getTime() ?? 0);
  return changedAt >= refreshedAt ? "stale" : "fresh";
}
