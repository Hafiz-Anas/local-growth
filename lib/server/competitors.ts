import "server-only";
import { db } from "@/lib/db";
import { getInstagramService, type CompetitorProfile } from "@/lib/services/instagram";
import { ApiError, notFound } from "./http";
import { getInstagramAccount } from "./instagram-account";
import { instagramApiError } from "./instagram-errors";
import { getPlanLimits } from "./settings";
import type { PlanId } from "@/types";

/** How many competitors the business's plan allows (System page → plan limits; default 5). */
export async function competitorLimit(businessId: string): Promise<number> {
  const [business, limits] = await Promise.all([db.business.findUniqueOrThrow({ where: { id: businessId }, select: { plan: true } }), getPlanLimits()]);
  return limits[business.plan.toLowerCase() as PlanId].competitors;
}

/** 409 with the limit in the details (the form says "up to {max}"). */
export function competitorLimitError(max: number) {
  return new ApiError(409, "conflict", `You can track up to ${max} competitors on your plan.`, [
    { path: "handle", message: "limit_reached" },
    { path: "max", message: String(max) },
  ]);
}

/** A tracked competitor of the caller's business, or 404 (other businesses' rows and unusable handles never match). */
export async function findOwnCompetitor(businessId: string, id: string) {
  const competitor = await db.competitor.findFirst({ where: { id, businessId, validationStatus: "READY" }, select: { id: true, handle: true } });
  if (!competitor) throw notFound("Competitor");
  return competitor;
}

/** Field reasons the competitor form shows for each lookup result. */
const LOOKUP_REASONS = {
  not_business: "not_business",
  private: "private_account",
  not_found: "no_such_account",
  own_account: "own_account",
} as const;

/**
 * Checks a handle for tracking (on add, or when an edit changes it) and looks
 * the account up on Instagram — which needs the business's own connection.
 * `excludeId` is the competitor being edited, so it doesn't clash with itself.
 * Only public business/creator accounts can be tracked (lookupBusinessAccount).
 */
export async function resolveCompetitorHandle(businessId: string, handle: string, excludeId?: string): Promise<CompetitorProfile> {
  const business = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { instagramHandle: true } });
  if (handle === business.instagramHandle) throw new ApiError(400, "validation_error", "You can't track your own account.", [{ path: "handle", message: "own_account" }]);

  const duplicate = await db.competitor.findFirst({ where: { businessId, handle, ...(excludeId && { id: { not: excludeId } }) }, select: { id: true, validationStatus: true } });
  if (duplicate?.validationStatus === "READY") throw new ApiError(409, "conflict", "You're already tracking this account.", [{ path: "handle", message: "already_tracked" }]);

  const account = await getInstagramAccount(businessId);
  if (!account.connected) throw new ApiError(409, "instagram_not_connected", "Connect Instagram to track competitors.");
  let lookup;
  try {
    lookup = await getInstagramService().lookupBusinessAccount(account, handle);
  } catch (error) {
    throw instagramApiError(error, "Instagram didn't answer. Try again in a moment.");
  }
  if (lookup.status !== "ready" || !lookup.profile) {
    const reason = LOOKUP_REASONS[lookup.status === "ready" ? "not_found" : lookup.status];
    const status = reason === "no_such_account" ? 404 : 400;
    throw new ApiError(status, status === 404 ? "not_found" : "validation_error", "This account can't be tracked.", [{ path: "handle", message: reason }]);
  }
  // A handle that failed validation during onboarding is replaced by the tracked one.
  if (duplicate) await db.competitor.delete({ where: { id: duplicate.id } });
  return lookup.profile;
}
