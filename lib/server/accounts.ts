import "server-only";
import { accountLimitFor } from "@/lib/accounts";
import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { initials, toneFor } from "@/lib/utils";
import type { AdminInstagramAccountsDto, InstagramAccountsDto, PlanId } from "@/types";
import { logActivity } from "./activity";
import { ApiError, notFound } from "./http";
import { connectionStatusOf } from "./instagram-account";
import { getPlanLimits } from "./settings";

/**
 * Instagram account switching. One login (User) belongs to several Instagram accounts
 * (Business rows, via BusinessMember); User.businessId is the active one, and every user
 * screen and API reads only that one (guards take it from the session, which is checked
 * against the memberships on every request — lib/auth/claims.ts). Background jobs (cron,
 * webhooks, publishing, reports) work per business and never look at the active account.
 * Pure rules: lib/accounts.ts.
 */

const ACCOUNT_SELECT = {
  id: true,
  name: true,
  instagramHandle: true,
  avatarUrl: true,
  plan: true,
  source: true,
  onboardingStatus: true,
  onboardingDeferredAt: true,
  instagramConnection: { select: { status: true, tokenExpiresAt: true } },
} satisfies Prisma.BusinessSelect;

type AccountRow = Prisma.BusinessGetPayload<{ select: typeof ACCOUNT_SELECT }>;

const planOf = (row: { plan: string }) => row.plan.toLowerCase() as PlanId;

async function memberAccounts(userId: string, client: Prisma.TransactionClient = db): Promise<AccountRow[]> {
  const rows = await client.businessMember.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, select: { business: { select: ACCOUNT_SELECT } } });
  return rows.map((r) => r.business);
}

/** The signed-in user's Instagram accounts for the switcher, with unread notifications per account. */
export async function listAccounts(userId: string, activeId: string): Promise<InstagramAccountsDto> {
  const [accounts, limits, unread] = await Promise.all([
    memberAccounts(userId),
    getPlanLimits(),
    db.notification.groupBy({ by: ["businessId"], where: { userId, readAt: null }, _count: { _all: true } }),
  ]);
  const unreadBy = new Map(unread.map((u) => [u.businessId, u._count._all]));
  const limit = accountLimitFor(accounts.map(planOf), limits);
  return {
    items: accounts.map((b) => ({
      id: b.id,
      handle: b.instagramHandle,
      name: b.name,
      avatarUrl: b.avatarUrl,
      avatarInitials: initials(b.name || b.instagramHandle || "IG"),
      avatarTone: toneFor(b.instagramHandle ?? b.id),
      connection: connectionStatusOf(b.instagramConnection),
      setupInProgress: b.onboardingStatus === "IN_PROGRESS",
      unread: unreadBy.get(b.id) ?? 0,
      active: b.id === activeId,
    })),
    count: accounts.length,
    limit,
    canAdd: accounts.length < limit,
  };
}

/**
 * Makes one of the user's accounts the active one. Anything the user isn't a member of is
 * 404 (whether it exists or not). Returns where to land: Home, or the setup of an account
 * whose onboarding isn't finished (and wasn't put off with "Finish later").
 */
export async function switchAccount(userId: string, businessId: string): Promise<{ home: "/dashboard" | "/onboarding" }> {
  const member = await db.businessMember.findUnique({
    where: { userId_businessId: { userId, businessId } },
    select: { business: { select: { onboardingStatus: true, onboardingDeferredAt: true } } },
  });
  if (!member) throw notFound("Instagram account");
  await db.user.update({ where: { id: userId }, data: { businessId } });
  const { onboardingStatus, onboardingDeferredAt } = member.business;
  return { home: onboardingStatus === "IN_PROGRESS" && !onboardingDeferredAt ? "/onboarding" : "/dashboard" };
}

/**
 * "Add account": a new Instagram account (Business) for this login, on the plan and with the
 * features of the account it was added from, and active right away; its setup is the
 * onboarding (connect Instagram, confirm the AI-filled details, goals). An added account that
 * never got Instagram connected is reused instead of making another. Over the plan's limit
 * → 409 `account_limit`.
 */
export async function addAccount(userId: string, fromBusinessId: string): Promise<{ id: string }> {
  const created = await db.$transaction(async (tx) => {
    // One add at a time per login, so two quick taps can't pass the limit together.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const accounts = await memberAccounts(userId, tx);
    const unfinished = accounts.find((b) => b.source === "ACCOUNT_ADDED" && b.onboardingStatus === "IN_PROGRESS" && !b.instagramHandle);
    if (unfinished) {
      await tx.user.update({ where: { id: userId }, data: { businessId: unfinished.id } });
      return { id: unfinished.id, reused: true };
    }
    const limit = accountLimitFor(accounts.map(planOf), await getPlanLimits());
    if (accounts.length >= limit) {
      throw new ApiError(409, "account_limit", "This plan's Instagram accounts are all in use.", [{ path: "limit", message: String(limit) }]);
    }
    const from = await tx.business.findUnique({
      where: { id: fromBusinessId },
      select: { plan: true, timezone: true, permissions: { select: { featureKey: true, enabled: true } } },
    });
    if (!from || !accounts.some((b) => b.id === fromBusinessId)) throw notFound("Instagram account");
    const business = await tx.business.create({
      data: {
        name: "",
        location: "",
        plan: from.plan,
        timezone: from.timezone,
        source: "ACCOUNT_ADDED",
        onboardingStatus: "IN_PROGRESS",
        onboardingStep: 1,
        permissionsUpdatedAt: new Date(),
        permissions: { create: from.permissions.map((p) => ({ featureKey: p.featureKey, enabled: p.enabled })) },
        brandVoice: { create: { defaultHashtags: [], brandWords: [], wordsToAvoid: [] } },
        members: { create: { userId } },
      },
      select: { id: true },
    });
    await tx.user.update({ where: { id: userId }, data: { businessId: business.id } });
    await logActivity({ businessId: business.id, userId, action: "account.added", details: { from: fromBusinessId } }, tx);
    return { id: business.id, reused: false };
  });
  return { id: created.id };
}

/**
 * Whether an Instagram handle is already one of this login's other accounts (so connecting it
 * again says "already in your accounts" rather than "connected elsewhere").
 */
export async function isOwnOtherAccount(userId: string, businessId: string, where: Prisma.BusinessWhereInput): Promise<boolean> {
  return (await db.business.count({ where: { ...where, id: { not: businessId }, members: { some: { userId } } } })) > 0;
}

/**
 * Admin: every Instagram account of the people on this client — the client itself plus the
 * accounts its logins added — with their limit (the plan's, admin System page).
 */
export async function adminAccountsFor(businessId: string): Promise<AdminInstagramAccountsDto> {
  const members = await db.businessMember.findMany({ where: { businessId }, select: { userId: true } });
  const userIds = members.map((m) => m.userId);
  const [rows, limits] = await Promise.all([
    db.business.findMany({
      where: userIds.length ? { members: { some: { userId: { in: userIds } } } } : { id: businessId },
      orderBy: { createdAt: "asc" },
      select: ACCOUNT_SELECT,
    }),
    getPlanLimits(),
  ]);
  // The limit is per login; with several logins on a client, show the busiest one.
  let count = rows.length;
  if (userIds.length > 1) {
    const perUser = await db.businessMember.groupBy({ by: ["userId"], where: { userId: { in: userIds } }, _count: { _all: true } });
    count = Math.max(...perUser.map((u) => u._count._all));
  }
  return {
    items: rows.map((b) => ({
      id: b.id,
      name: b.name,
      handle: b.instagramHandle,
      connection: connectionStatusOf(b.instagramConnection),
      setupInProgress: b.onboardingStatus === "IN_PROGRESS",
      plan: planOf(b),
    })),
    count,
    limit: accountLimitFor(rows.map(planOf), limits),
  };
}

/**
 * The account switcher's current account for the full-screen set-up pages (connect Instagram, the
 * wizard), only when the login has other accounts — a way back from an added account's set-up.
 */
export async function setupSwitcherAccount(userId: string, businessId: string | null) {
  if (!businessId) return undefined;
  const [business, count] = await Promise.all([
    db.business.findUnique({ where: { id: businessId }, select: { name: true, instagramHandle: true, avatarUrl: true } }),
    db.businessMember.count({ where: { userId } }),
  ]);
  if (!business || count < 2) return undefined;
  return {
    handle: business.instagramHandle,
    name: business.name,
    avatarUrl: business.avatarUrl,
    avatarInitials: initials(business.name || business.instagramHandle || "IG"),
    avatarTone: toneFor(business.instagramHandle ?? businessId),
  };
}
