import "server-only";
import { getSession } from "@/lib/auth/server";
import { isFeatureEnabled, permissionsFromKeys } from "@/lib/permissions";
import type { FeatureKey, Permissions, Session } from "@/types";
import { ApiError } from "./http";

/**
 * Guards for API routes. Each one throws an ApiError that `handler()` turns
 * into the JSON error response.
 *
 * The session is validated against the database on every request (see auth.ts):
 * revoked sessions are rejected and changed features are reloaded, so these
 * checks always see current permissions.
 */

export async function requireAuth(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new ApiError(401, "unauthorized", "Sign in to continue.");
  return session;
}

export async function requireRole(role: "ADMIN" | "USER"): Promise<Session> {
  const session = await requireAuth();
  if (session.role !== (role === "ADMIN" ? "admin" : "user")) throw new ApiError(403, "forbidden", "You don't have access to this.");
  return session;
}

export interface BusinessContext {
  session: Session;
  /** Always taken from the session — never from the request. */
  businessId: string;
  permissions: Permissions;
}

/** A signed-in USER with a business. */
export async function requireBusiness(): Promise<BusinessContext> {
  const session = await requireRole("USER");
  if (!session.businessId) throw new ApiError(403, "forbidden", "This account has no business.");
  return { session, businessId: session.businessId, permissions: permissionsFromKeys(session.features) };
}

/**
 * Requires every listed feature (and its module). A disabled feature answers
 * 404, not 403, so its existence is not revealed.
 */
export async function requireFeature(...keys: FeatureKey[]): Promise<BusinessContext> {
  const context = await requireBusiness();
  if (!keys.every((key) => isFeatureEnabled(context.permissions, key))) throw new ApiError(404, "not_found", "Not found.");
  return context;
}

/** Requires at least one of the listed features. */
export async function requireAnyFeature(...keys: FeatureKey[]): Promise<BusinessContext> {
  const context = await requireBusiness();
  if (!keys.some((key) => isFeatureEnabled(context.permissions, key))) throw new ApiError(404, "not_found", "Not found.");
  return context;
}

/** Throws 404 when a feature is off — for fields or sections inside an otherwise allowed request. */
export function assertFeature(permissions: Permissions, key: FeatureKey): void {
  if (!isFeatureEnabled(permissions, key)) throw new ApiError(404, "not_found", "Not found.");
}
