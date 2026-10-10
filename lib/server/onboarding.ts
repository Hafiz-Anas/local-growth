import "server-only";
import {
  EVENT_STEPS,
  MAX_ONBOARDING_COMPETITORS,
  MIN_READY_COMPETITORS,
  ONBOARDING_POST_SLOTS,
  ONBOARDING_STEPS,
  stepId,
  stepNumber,
  type EventStepId,
  type OnboardingStepId,
} from "@/config/onboarding";
import { db } from "@/lib/db";
import type { CompetitorValidation as DbCompetitorValidation, OnboardingEventType as DbEventType, Prisma } from "@/lib/generated/prisma/client";
import { getEmailService } from "@/lib/services/email";
import { getInstagramService } from "@/lib/services/instagram";
import type {
  AdminOnboardingBusinessDto,
  AdminOnboardingDto,
  BusinessType,
  CompetitorValidation,
  OnboardingCompetitorDto,
  OnboardingEventType,
  OnboardingStateDto,
  PlanId,
} from "@/types";
import { logActivity } from "./activity";
import { currentBrandContext, getBrandBasics, listBrandPosts } from "./brand";
import { MAX_COMPETITORS } from "./competitors";
import { requireBusiness, type BusinessContext } from "./guards";
import { ApiError, notFound } from "./http";
import { recordCompetitorFetch } from "./competitor-profiles";
import { INTEGRATION_EVENT_SELECT, toIntegrationEvent } from "./integration-log";
import { getRequireInstagramConnection } from "./settings";
import { getConnectionDto, getInstagramAccount } from "./instagram-account";
import { instagramApiError, lookupFailureReason } from "./instagram-errors";

/**
 * Self-onboarding: wizard state, step rules and the event trail admins use to
 * find where people get stuck. Every step start/finish, back-navigation,
 * validation error, failed upload and failed competitor lookup is recorded
 * as an OnboardingEvent.
 */

const lower = <T extends string>(value: T) => value.toLowerCase() as Lowercase<T>;
/** Longest single visit counted towards "time spent" (tabs left open overnight would skew it). */
const MAX_VISIT_MS = 2 * 60 * 60 * 1000;

// Guard ------------------------------------------------------------------------

export interface OnboardingContext extends BusinessContext {
  step: OnboardingStepId;
}

/** A business user whose onboarding is still in progress (wizard-only routes). */
export async function requireOnboarding(): Promise<OnboardingContext> {
  const context = await requireBusiness();
  const business = await db.business.findUnique({ where: { id: context.businessId }, select: { onboardingStatus: true, onboardingStep: true } });
  if (!business) throw notFound("Business");
  if (business.onboardingStatus !== "IN_PROGRESS") throw new ApiError(409, "conflict", "Onboarding is already complete.", [{ path: "onboarding", message: "completed" }]);
  return { ...context, step: stepId(business.onboardingStep) };
}

// Events -----------------------------------------------------------------------

export async function recordEvent(
  businessId: string,
  step: EventStepId,
  event: OnboardingEventType,
  extra: { details?: Prisma.InputJsonValue; durationMs?: number | null } = {},
  client: Prisma.TransactionClient = db,
) {
  await client.onboardingEvent.create({
    data: { businessId, step, event: event.toUpperCase() as DbEventType, details: extra.details ?? {}, durationMs: extra.durationMs ?? null },
  });
}

/** Records an ERROR without letting a logging failure hide the original problem. */
export async function recordError(businessId: string, step: EventStepId, details: Prisma.InputJsonValue) {
  await recordEvent(businessId, step, "error", { details }).catch((e) => console.error("[onboarding] recordError failed", e));
}

/** Time since the step was last opened (null when it never was). */
async function visitDuration(businessId: string, step: EventStepId, client: Prisma.TransactionClient = db): Promise<number | null> {
  const started = await client.onboardingEvent.findFirst({
    where: { businessId, step, event: "STARTED" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return started ? Math.min(MAX_VISIT_MS, Date.now() - started.createdAt.getTime()) : null;
}

/**
 * The wizard reports when a step opens. Repeats within a few seconds (re-renders,
 * a second tab) are ignored so a visit is only counted once.
 */
export async function recordStepStarted(businessId: string, step: EventStepId) {
  const last = await db.onboardingEvent.findFirst({ where: { businessId }, orderBy: { createdAt: "desc" }, select: { step: true, event: true, createdAt: true } });
  if (last && last.step === step && last.event === "STARTED" && Date.now() - last.createdAt.getTime() < 10_000) return;
  await recordEvent(businessId, step, "started");
}

/** The page was closed or hidden mid-step (sent with navigator.sendBeacon). */
export async function recordAbandoned(businessId: string, step: EventStepId, details?: Prisma.InputJsonValue) {
  await recordEvent(businessId, step, "abandoned", { details, durationMs: await visitDuration(businessId, step) });
}

// State ------------------------------------------------------------------------

const ONBOARDING_COMPETITOR_SELECT = {
  id: true,
  handle: true,
  displayName: true,
  validationStatus: true,
  avatarUrl: true,
  followers: true,
  lastValidatedAt: true,
} satisfies Prisma.CompetitorSelect;

function toOnboardingCompetitor(row: Prisma.CompetitorGetPayload<{ select: typeof ONBOARDING_COMPETITOR_SELECT }>, name: string | null): OnboardingCompetitorDto {
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.displayName,
    status: lower(row.validationStatus),
    name,
    avatarUrl: row.avatarUrl,
    followers: row.followers,
    lastValidatedAt: row.lastValidatedAt?.toISOString() ?? null,
  };
}

async function listOnboardingCompetitors(businessId: string): Promise<OnboardingCompetitorDto[]> {
  const rows = await db.competitor.findMany({ where: { businessId }, select: ONBOARDING_COMPETITOR_SELECT, orderBy: { id: "asc" } });
  return rows.map((row) => toOnboardingCompetitor(row, null));
}

export async function getOnboardingState(businessId: string, userId: string): Promise<OnboardingStateDto> {
  const [business, user, competitors, posts, brand, brandContext, instagram, instagramRequired] = await Promise.all([
    db.business.findUnique({
      where: { id: businessId },
      select: {
        name: true,
        businessType: true,
        businessTypeOther: true,
        location: true,
        description: true,
        products: true,
        targetAudience: true,
        instagramHandle: true,
        onboardingStatus: true,
        onboardingStep: true,
      },
    }),
    db.user.findUnique({ where: { id: userId }, select: { email: true, emailVerifiedAt: true } }),
    listOnboardingCompetitors(businessId),
    listBrandPosts(businessId),
    getBrandBasics(businessId),
    currentBrandContext(businessId),
    getConnectionDto(businessId),
    getRequireInstagramConnection(),
  ]);
  if (!business || !user) throw notFound("Business");
  return {
    status: lower(business.onboardingStatus),
    step: stepId(business.onboardingStep),
    email: user.email,
    emailVerified: Boolean(user.emailVerifiedAt),
    business: {
      name: business.name,
      businessType: (business.businessType as BusinessType | null) ?? null,
      businessTypeOther: business.businessTypeOther,
      location: business.location,
      description: business.description,
      products: business.products,
      targetAudience: business.targetAudience,
    },
    instagram: { ...instagram, handle: business.instagramHandle, required: instagramRequired },
    competitors,
    posts,
    brand,
    brandContext,
  };
}

// Step rules ---------------------------------------------------------------------

async function hasWorkingConnection(businessId: string): Promise<boolean> {
  return (await db.instagramConnection.count({ where: { businessId, status: "CONNECTED" } })) > 0;
}

/** Why a step can't be left yet (null when it can). Mirrors the checks the wizard shows. */
async function blockerFor(businessId: string, step: OnboardingStepId): Promise<string | null> {
  switch (step) {
    case "business": {
      const b = await db.business.findUnique({ where: { id: businessId }, select: { businessType: true, location: true, description: true, products: true } });
      if (!b?.businessType || !b.location || !b.description || b.products.length === 0) return "business_incomplete";
      return null;
    }
    case "instagram":
      return (await getRequireInstagramConnection()) && !(await hasWorkingConnection(businessId)) ? "instagram_required" : null;
    case "competitors": {
      const ready = await db.competitor.count({ where: { businessId, validationStatus: "READY" } });
      return ready >= MIN_READY_COMPETITORS ? null : "not_enough_competitors";
    }
    case "posts": {
      const posts = await db.brandPost.count({ where: { businessId } });
      return posts === ONBOARDING_POST_SLOTS ? null : "posts_incomplete";
    }
    case "review":
      return (await currentBrandContext(businessId)) ? null : "brand_context_missing";
    default:
      return null;
  }
}

/**
 * Moves the wizard. Forward moves go one step at a time and only when the
 * current step is complete; back moves and Edit links ("jump") may go to any
 * earlier step. Each move closes the current visit (COMPLETED or BACK with its
 * duration) and opens the next one (STARTED).
 */
export async function moveToStep(
  context: OnboardingContext,
  to: OnboardingStepId,
  direction: "forward" | "back" | "jump",
  details?: Record<string, unknown>,
): Promise<OnboardingStepId> {
  const { businessId, session } = context;
  const from = context.step;
  const fromN = stepNumber(from);
  const toN = stepNumber(to);

  if (direction === "forward") {
    if (toN !== fromN + 1 || to === "result") throw new ApiError(400, "validation_error", "Finish the current step first.", [{ path: "step", message: "out_of_order" }]);
    // Example posts can be skipped (and added later in Settings → Brand profile).
    const blocker = from === "posts" && details?.skipped ? null : await blockerFor(businessId, from);
    if (blocker) {
      await recordError(businessId, from, { reason: blocker });
      throw new ApiError(400, "validation_error", "This step isn't complete yet.", [{ path: "step", message: blocker }]);
    }
  } else if (toN >= fromN) {
    throw new ApiError(400, "validation_error", "You can only go back to an earlier step.", [{ path: "step", message: "out_of_order" }]);
  }

  await db.$transaction(async (tx) => {
    const durationMs = await visitDuration(businessId, from, tx);
    const detailJson = (details ?? {}) as Prisma.InputJsonObject;
    if (direction === "forward") await recordEvent(businessId, from, "completed", { durationMs, details: detailJson }, tx);
    else await recordEvent(businessId, from, "back", { durationMs, details: { ...detailJson, to, via: direction } }, tx);
    await recordEvent(businessId, to, "started", {}, tx);
    await tx.business.update({ where: { id: businessId }, data: { onboardingStep: toN } });
  });
  if (direction === "forward" && from === "instagram" && details?.skipped) {
    await logActivity({ businessId, userId: session.userId, action: "onboarding.instagram_skipped" });
  }
  if (direction === "forward" && from === "posts" && details?.skipped) {
    await logActivity({ businessId, userId: session.userId, action: "onboarding.posts_skipped", details: { posts: details.posts ?? null } });
  }
  return to;
}

/** The brand profile was built: the wizard moves from "review" to "result". */
export async function markBrandBuilt(businessId: string, version: number) {
  await db.$transaction(async (tx) => {
    const durationMs = await visitDuration(businessId, "review", tx);
    await recordEvent(businessId, "review", "completed", { durationMs, details: { version } }, tx);
    await recordEvent(businessId, "result", "started", {}, tx);
    await tx.business.update({ where: { id: businessId }, data: { onboardingStep: stepNumber("result") } });
  });
}

/** "Confirm" on the brand-profile screen: onboarding is done. */
export async function completeOnboarding(context: OnboardingContext) {
  const { businessId, session } = context;
  if ((await getRequireInstagramConnection()) && !(await hasWorkingConnection(businessId))) {
    await recordError(businessId, "result", { reason: "instagram_required" });
    throw new ApiError(400, "validation_error", "Connect Instagram to finish.", [{ path: "step", message: "instagram_required" }]);
  }
  if (!(await currentBrandContext(businessId))) {
    await recordError(businessId, "result", { reason: "brand_context_missing" });
    throw new ApiError(400, "validation_error", "Build your brand profile first.", [{ path: "step", message: "brand_context_missing" }]);
  }
  await db.$transaction(async (tx) => {
    const durationMs = await visitDuration(businessId, "result", tx);
    await recordEvent(businessId, "result", "completed", { durationMs }, tx);
    await tx.business.update({ where: { id: businessId }, data: { onboardingStatus: "COMPLETED", onboardingStep: stepNumber("result") } });
    await logActivity({ businessId, userId: session.userId, action: "onboarding.completed" }, tx);
  });
}

// Competitors ----------------------------------------------------------------------

const TO_DB_STATUS: Record<CompetitorValidation, DbCompetitorValidation> = {
  ready: "READY",
  not_business: "NOT_BUSINESS",
  private: "PRIVATE",
  not_found: "NOT_FOUND",
  own_account: "OWN_ACCOUNT",
};

/**
 * Adds a handle in step 3 and validates it through InstagramService. Every
 * handle is kept with its status so the wizard can explain why it can't be
 * used; only Ready ones are tracked on Competitor Insights.
 */
export async function addOnboardingCompetitor(businessId: string, handle: string, displayName: string | null): Promise<OnboardingCompetitorDto> {
  const [count, readyCount, duplicate, business] = await Promise.all([
    db.competitor.count({ where: { businessId } }),
    db.competitor.count({ where: { businessId, validationStatus: "READY" } }),
    db.competitor.findFirst({ where: { businessId, handle }, select: { id: true } }),
    db.business.findUniqueOrThrow({ where: { id: businessId }, select: { instagramHandle: true } }),
  ]);
  if (duplicate) throw new ApiError(409, "conflict", "This account is already on your list.", [{ path: "handle", message: "already_tracked" }]);
  if (count >= MAX_ONBOARDING_COMPETITORS) {
    throw new ApiError(409, "conflict", `You can list up to ${MAX_ONBOARDING_COMPETITORS} accounts.`, [{ path: "handle", message: "limit_reached" }]);
  }

  const account = await getInstagramAccount(businessId);
  let lookup;
  try {
    lookup = handle === business.instagramHandle ? { status: "own_account" as const, profile: null } : await getInstagramService().lookupBusinessAccount(account, handle);
  } catch (error) {
    const reason = lookupFailureReason(error);
    if (reason === "lookup_failed") console.error("[onboarding] lookupBusinessAccount failed", error);
    await recordError(businessId, "competitors", { kind: "competitor_lookup", handle, reason });
    throw instagramApiError(error, "Instagram didn't answer. Try again in a moment.");
  }
  if (lookup.status === "ready" && readyCount >= MAX_COMPETITORS) {
    throw new ApiError(409, "conflict", `You can track up to ${MAX_COMPETITORS} competitors.`, [{ path: "handle", message: "limit_reached" }]);
  }
  if (lookup.status !== "ready") await recordError(businessId, "competitors", { kind: "competitor_lookup", handle, reason: lookup.status });

  const profile = lookup.profile;
  const now = new Date();
  const row = await db.competitor.create({
    data: {
      businessId,
      handle,
      displayName,
      validationStatus: TO_DB_STATUS[lookup.status],
      lastValidatedAt: now,
      ...(profile && { avatarUrl: profile.avatarUrl, followers: profile.followers, engagementRate: profile.engagementRate, lastFetchedAt: now }),
    },
    select: ONBOARDING_COMPETITOR_SELECT,
  });
  if (profile && account.provider === "meta") await recordCompetitorFetch(row.id, profile);
  return toOnboardingCompetitor(row, profile?.name ?? null);
}

// Admin --------------------------------------------------------------------------

/** Admin: ask an existing (admin-created) client to go through onboarding. */
export async function inviteToOnboarding(businessId: string, actorId: string, baseUrl: string) {
  const business = await db.business.findUnique({
    where: { id: businessId },
    select: { name: true, onboardingStatus: true, users: { where: { role: "USER", status: "ACTIVE" }, select: { email: true, name: true } } },
  });
  if (!business) throw notFound("Business");
  if (business.users.length === 0) throw new ApiError(409, "conflict", "This business has no login to invite.", [{ path: "users", message: "no_users" }]);

  await db.$transaction(async (tx) => {
    await tx.business.update({
      where: { id: businessId },
      data: { onboardingStatus: "IN_PROGRESS", onboardingInvitedAt: new Date(), ...(business.onboardingStatus === "COMPLETED" && { onboardingStep: 1 }) },
    });
    await logActivity({ businessId, userId: actorId, action: "onboarding.invited", details: { recipients: business.users.length } }, tx);
  });
  const loginUrl = new URL("/login", baseUrl).toString();
  for (const user of business.users) {
    await getEmailService().sendOnboardingInvite({ to: user.email, name: user.name, businessName: business.name, loginUrl });
  }
  return { recipients: business.users.length };
}

const FUNNEL_STEPS = [...EVENT_STEPS, "completed"] as const;

/** Admin Onboarding page: every self sign-up (and invited client) with its progress, timings, errors and feedback. */
export async function getAdminOnboarding(): Promise<AdminOnboardingDto> {
  const rows = await db.business.findMany({
    where: { OR: [{ source: "SELF_SIGNUP" }, { onboardingInvitedAt: { not: null } }] },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      source: true,
      plan: true,
      createdAt: true,
      onboardingStatus: true,
      onboardingStep: true,
      users: { where: { role: "USER" }, select: { name: true, email: true, emailVerifiedAt: true }, orderBy: { createdAt: "asc" }, take: 1 },
      onboardingEvents: { select: { id: true, step: true, event: true, details: true, durationMs: true, createdAt: true }, orderBy: { createdAt: "asc" } },
      feedback: { select: { id: true, step: true, note: true, createdAt: true, user: { select: { name: true } } }, orderBy: { createdAt: "desc" } },
      integrationEvents: { select: INTEGRATION_EVENT_SELECT, orderBy: { createdAt: "desc" }, take: 20 },
    },
  });

  const asEventStep = (step: string): EventStepId => ((EVENT_STEPS as readonly string[]).includes(step) ? (step as EventStepId) : "business");

  const businesses: AdminOnboardingBusinessDto[] = rows.map((b) => {
    const events = b.onboardingEvents;
    const timePerStep: AdminOnboardingBusinessDto["timePerStep"] = {};
    let furthest = b.onboardingStep;
    for (const e of events) {
      const n = ONBOARDING_STEPS.indexOf(e.step as OnboardingStepId) + 1;
      if (n > 0 && e.event === "STARTED") furthest = Math.max(furthest, n);
      if (n > 0 && e.durationMs && e.event !== "STARTED" && e.event !== "ERROR") {
        const id = e.step as OnboardingStepId;
        timePerStep[id] = (timePerStep[id] ?? 0) + e.durationMs;
      }
    }
    const errors = events.filter((e) => e.event === "ERROR");
    const completed = b.onboardingStatus === "COMPLETED" ? [...events].reverse().find((e) => e.step === "result" && e.event === "COMPLETED") : undefined;
    const owner = b.users[0];
    return {
      id: b.id,
      name: b.name,
      avatarUrl: b.avatarUrl,
      owner: owner ? { name: owner.name, email: owner.email, emailVerified: Boolean(owner.emailVerifiedAt) } : null,
      source: lower(b.source),
      status: lower(b.onboardingStatus),
      step: stepId(b.onboardingStep),
      reached: b.onboardingStatus === "COMPLETED" ? "result" : stepId(furthest),
      plan: lower(b.plan) as PlanId,
      createdAt: b.createdAt.toISOString(),
      completedAt: completed?.createdAt.toISOString() ?? null,
      lastEventAt: events.at(-1)?.createdAt.toISOString() ?? null,
      timePerStep,
      errorCount: errors.length,
      errors: errors
        .slice(-20)
        .reverse()
        .map((e) => ({ id: e.id, step: asEventStep(e.step), details: e.details, createdAt: e.createdAt.toISOString() })),
      feedback: b.feedback.map((f) => ({ id: f.id, step: asEventStep(f.step), note: f.note, userName: f.user?.name ?? null, createdAt: f.createdAt.toISOString() })),
      integrationEvents: b.integrationEvents.map(toIntegrationEvent),
    };
  });

  // Funnel over self sign-ups: how many reached each step (and finished).
  const signups = businesses.filter((b) => b.source === "self_signup");
  const reachedIndex = (b: AdminOnboardingBusinessDto) => (b.status === "completed" ? FUNNEL_STEPS.length - 1 : FUNNEL_STEPS.indexOf(b.reached));
  const funnel = FUNNEL_STEPS.map((step, i) => ({ step, reached: signups.filter((b) => reachedIndex(b) >= i).length }));

  return {
    funnel,
    totals: {
      signups: signups.length,
      completed: signups.filter((b) => b.status === "completed").length,
      inProgress: businesses.filter((b) => b.status === "in_progress").length,
      withErrors: businesses.filter((b) => b.errorCount > 0).length,
      feedback: businesses.reduce((n, b) => n + b.feedback.length, 0),
    },
    businesses,
  };
}
