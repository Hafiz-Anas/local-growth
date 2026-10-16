import type { PlanLimits } from "@/config/plans";
import type { PlanId } from "@/types";

/**
 * Instagram account switching — the pure rules (tested in tests/accounts.test.ts).
 * One login (User) can belong to several Instagram accounts (Business, via BusinessMember);
 * User.businessId is the active one. The server code is lib/server/accounts.ts.
 */

/**
 * Request header carrying the account a screen was rendered for (apiFetch adds it). The API
 * answers 409 `account_switched` when it isn't the active account any more — e.g. the user
 * switched in another tab — so an old screen can't change the newly active account.
 */
export const ACCOUNT_HEADER = "x-lge-account";

/**
 * The account a session may use: the saved active one when the user still belongs to it,
 * otherwise their oldest account (`memberIds` oldest first), or null when they have none.
 */
export function resolveActiveAccount(activeId: string | null, memberIds: string[]): string | null {
  if (activeId && memberIds.includes(activeId)) return activeId;
  return memberIds[0] ?? null;
}

/**
 * How many Instagram accounts a login may have: the highest limit among the plans of the
 * accounts it already has (added accounts copy the plan they were added from). At least 1.
 */
export function accountLimitFor(plans: PlanId[], limits: Record<PlanId, PlanLimits>): number {
  return Math.max(1, ...plans.map((plan) => limits[plan]?.instagramAccounts ?? 1));
}

/** True when a screen rendered for one account calls the API while another one is active. */
export function accountMismatch(rendered: string | null | undefined, active: string | null): boolean {
  return Boolean(rendered) && rendered !== active;
}
