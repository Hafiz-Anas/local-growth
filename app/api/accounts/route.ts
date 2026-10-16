import { addAccount, listAccounts } from "@/lib/server/accounts";
import { requireBusiness } from "@/lib/server/guards";
import { handler, ok } from "@/lib/server/http";

/** GET /api/accounts — the signed-in user's Instagram accounts (switcher), with unread counts and the plan limit. */
export const GET = handler(async () => {
  const { session, businessId } = await requireBusiness();
  return ok(await listAccounts(session.userId, businessId));
});

/**
 * POST /api/accounts — "Add account": a new Instagram account on this login, active right away;
 * the client then opens its setup (/onboarding). 409 `account_limit` over the plan's limit.
 */
export const POST = handler(async () => {
  const { session, businessId } = await requireBusiness();
  return ok(await addAccount(session.userId, businessId), { status: 201 });
});
