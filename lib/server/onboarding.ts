import "server-only";
import { after } from "next/server";
import {
  DEFAULT_AIM,
  DEFAULT_GOALS,
  DEFAULT_TIMELINE,
  EVENT_STEPS,
  MAX_ONBOARDING_COMPETITORS,
  ONBOARDING_STEPS,
  stepId,
  stepNumber,
  type EventStepId,
  type OnboardingStepId,
} from "@/config/onboarding";
import { db } from "@/lib/db";
import type { CompetitorValidation as DbCompetitorValidation, OnboardingEventType as DbEventType, Prisma } from "@/lib/generated/prisma/client";
import { displayNameFromHandle } from "@/lib/display-names";
import { aimFromTargets, readTargets } from "@/lib/onboarding-answers";
import { EmailSendError, emailLocale, getEmailService } from "@/lib/services/email";
import { getInstagramService } from "@/lib/services/instagram";
import type {
  AdminOnboardingBusinessDto,
  AdminOnboardingDto,
  BusinessType,
  CompetitorValidation,
  Feeling,
  OnboardingCompetitorDto,
  OnboardingEventType,
  OnboardingPrefillDto,
  OnboardingStateDto,
  PlanId,
  ServiceMode,
} from "@/types";
import { logActivity } from "./activity";
import { buildBrandContext, currentBrandContext, getBrandBasics, listBrandPosts } from "./brand";
import { competitorLimit, competitorLimitError } from "./competitors";
import { requireBusiness, type BusinessContext } from "./guards";
import { ApiError, notFound } from "./http";
import { recordCompetitorFetch } from "./competitor-profiles";
import { INTEGRATION_EVENT_SELECT, toIntegrationEvent } from "./integration-log";
import { getRequireInstagramConnection } from "./settings";
import { getConnectionDto, getInstagramAccount } from "./instagram-account";
import { instagramApiError, lookupFailureReason } from "./instagram-errors";
import { ensureStyleGuide, getStyleGuide } from "./style-guide";

/**
 * Self-onboarding: the Instagram gate after sign-up, wizard state, step rules and the event trail
 * admins use to find where people get stuck. Every step start/finish/skip, back-navigation,
 * validation error, failed upload and failed competitor lookup is recorded as an OnboardingEvent.
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

// Instagram gate ---------------------------------------------------------------

/**
 * Sign-up connects Instagram: a self sign-up (or a newly added account) that never connected one is
 * sent back to /signup/instagram until it does — so is any business still in onboarding while admins
 * require a connection (System setting). A later disconnect in Settings doesn't bring the gate back.
 */
export async function needsInstagramConnection(businessId: string): Promise<boolean> {
  const business = await db.business.findUnique({
    where: { id: businessId },
    select: { source: true, onboardingStatus: true, instagramConnection: { select: { id: true } } },
  });
  if (!business || business.instagramConnection) return false;
  if (business.source !== "ADMIN_CREATED") return true;
  return business.onboardingStatus === "IN_PROGRESS" && (await getRequireInstagramConnection());
}

/**
 * The business name comes from Instagram: a business without one (new sign-up, added account) takes
 * the account's display name, or a readable form of the username. Editable in Settings.
 */
export async function adoptInstagramName(businessId: string, username: string, displayName: string | null | undefined) {
  const name = displayName?.replace(/\s+/g, " ").trim().slice(0, 120) || displayNameFromHandle(username) || username;
  await db.business.updateMany({ where: { id: businessId, name: "" }, data: { name } });
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
  const [business, user, competitors, posts, brand, voice, instagram, style] = await Promise.all([
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
        niche: true,
        aim: true,
        goals: true,
        timeline: true,
        exampleCaption: true,
        targets: true,
        feelings: true,
        feelingOther: true,
        governorate: true,
        area: true,
        serviceMode: true,
        onboardingPrefill: true,
        instagramHandle: true,
        onboardingStatus: true,
        onboardingStep: true,
      },
    }),
    db.user.findUnique({ where: { id: userId }, select: { email: true, emailVerifiedAt: true } }),
    listOnboardingCompetitors(businessId),
    listBrandPosts(businessId),
    getBrandBasics(businessId),
    db.brandVoice.findUnique({ where: { businessId }, select: { defaultHashtags: true } }),
    getConnectionDto(businessId),
    getStyleGuide(businessId),
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
      niche: business.niche,
      aim: business.aim,
      goals: business.goals,
      timeline: business.timeline,
      exampleCaption: business.exampleCaption,
      targets: readTargets(business.targets),
      feelings: business.feelings as Feeling[],
      feelingOther: business.feelingOther,
      governorate: business.governorate,
      area: business.area,
      serviceMode: business.serviceMode as ServiceMode | null,
    },
    instagram: { ...instagram, handle: business.instagramHandle },
    competitors,
    posts,
    brand,
    hashtags: voice?.defaultHashtags ?? [],
    prefill: readPrefill(business.onboardingPrefill),
    style,
  };
}

// Step rules ---------------------------------------------------------------------

/** The stored pre-fill (Business.onboardingPrefill), or null before the brand step asked for it. */
function readPrefill(stored: Prisma.JsonValue | null): OnboardingPrefillDto | null {
  return stored && typeof stored === "object" && !Array.isArray(stored) ? (stored as unknown as OnboardingPrefillDto) : null;
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

  // Every step can be skipped (details.skipped), so a forward move only has to be to the next step.
  if (direction === "forward") {
    if (toN !== fromN + 1) throw new ApiError(400, "validation_error", "Finish the current step first.", [{ path: "step", message: "out_of_order" }]);
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
  if (direction === "forward" && details?.skipped) {
    await logActivity({ businessId, userId: session.userId, action: "onboarding.step_skipped", details: { step: from } });
  }
  return to;
}

/**
 * "Finish" (from the last step, or "Skip" on it): onboarding is done. Goals the owner didn't touch
 * get their defaults (the main aim follows the first target picked); the brand profile and — when
 * "Your style" was skipped — the style guide from the recent posts are built after the response,
 * so finishing never waits for the AI.
 */
export async function completeOnboarding(context: OnboardingContext) {
  const { businessId, session } = context;
  const business = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { aim: true, goals: true, timeline: true, targets: true } });
  await db.$transaction(async (tx) => {
    const durationMs = await visitDuration(businessId, context.step, tx);
    await recordEvent(businessId, context.step, "completed", { durationMs, details: { finished: true } }, tx);
    await tx.business.update({
      where: { id: businessId },
      data: {
        onboardingStatus: "COMPLETED",
        onboardingStep: ONBOARDING_STEPS.length,
        onboardingDeferredAt: null,
        aim: business.aim ?? aimFromTargets(readTargets(business.targets)) ?? DEFAULT_AIM,
        goals: business.goals.length ? business.goals : DEFAULT_GOALS,
        timeline: business.timeline ?? DEFAULT_TIMELINE,
        // Their goals and the new steps are done: no one-time prompts later.
        goalsPromptDoneAt: new Date(),
        setupPromptDoneAt: new Date(),
      },
    });
    await logActivity({ businessId, userId: session.userId, action: "onboarding.completed" }, tx);
  });
  if (!(await currentBrandContext(businessId))) {
    after(() => buildBrandContext(businessId, session.userId).then(() => undefined).catch((e) => console.error("[onboarding] brand profile build failed", (e as Error).message)));
  }
  await ensureStyleGuide(businessId);
}

/**
 * Businesses that finished the older wizard: "Complete the new steps" on the dashboard reopens the
 * wizard at its first step (the app stays open, like after "Finish later"); "Skip" dismisses it for good.
 */
export async function startNewSteps(businessId: string, userId: string) {
  const business = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { onboardingStatus: true } });
  if (business.onboardingStatus === "IN_PROGRESS") return;
  await db.$transaction(async (tx) => {
    await tx.business.update({
      where: { id: businessId },
      data: { onboardingStatus: "IN_PROGRESS", onboardingStep: 1, onboardingDeferredAt: new Date(), setupPromptDoneAt: new Date() },
    });
    await logActivity({ businessId, userId, action: "onboarding.new_steps_started" }, tx);
  });
}

export async function skipNewSteps(businessId: string) {
  await db.business.update({ where: { id: businessId }, data: { setupPromptDoneAt: new Date() } });
}

/** "Finish later": the app opens; the wizard keeps its place and the dashboard links back to it. */
export async function deferOnboarding(context: OnboardingContext) {
  await db.business.update({ where: { id: context.businessId }, data: { onboardingDeferredAt: new Date() } });
  await recordEvent(context.businessId, context.step, "abandoned", { details: { reason: "finish_later" } });
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
  if (lookup.status === "ready") {
    const max = await competitorLimit(businessId);
    if (readyCount >= max) throw competitorLimitError(max);
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
    select: {
      name: true,
      onboardingStatus: true,
      members: { where: { user: { role: "USER", status: "ACTIVE" } }, select: { user: { select: { email: true, name: true, uiPreferences: true } } } },
    },
  });
  if (!business) throw notFound("Business");
  const users = business.members.map((m) => m.user);
  if (users.length === 0) throw new ApiError(409, "conflict", "This business has no login to invite.", [{ path: "users", message: "no_users" }]);

  await db.$transaction(async (tx) => {
    await tx.business.update({
      where: { id: businessId },
      data: { onboardingStatus: "IN_PROGRESS", onboardingInvitedAt: new Date(), ...(business.onboardingStatus === "COMPLETED" && { onboardingStep: 1 }) },
    });
    await logActivity({ businessId, userId: actorId, action: "onboarding.invited", details: { recipients: users.length } }, tx);
  });
  const loginUrl = new URL("/login", baseUrl).toString();
  // The invite itself is saved; a failed email (already logged) only lowers the count the admin sees.
  let emailed = 0;
  for (const user of users) {
    try {
      await getEmailService().sendOnboardingInvite({ to: user.email, name: user.name, locale: emailLocale(user.uiPreferences), businessName: business.name, loginUrl });
      emailed++;
    } catch (error) {
      if (!(error instanceof EmailSendError)) throw error;
    }
  }
  return { recipients: users.length, emailed };
}

const FUNNEL_STEPS = [...EVENT_STEPS, "completed"] as const;

/** Admin Onboarding page: every self sign-up (and invited client) with its progress, timings, errors and feedback. */
export async function getAdminOnboarding(): Promise<AdminOnboardingDto> {
  const rows = await db.business.findMany({
    where: { OR: [{ source: { in: ["SELF_SIGNUP", "ACCOUNT_ADDED"] } }, { onboardingInvitedAt: { not: null } }] },
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
      members: { where: { user: { role: "USER" } }, select: { user: { select: { name: true, email: true, emailVerifiedAt: true } } }, orderBy: { createdAt: "asc" }, take: 1 },
      onboardingEvents: { select: { id: true, step: true, event: true, details: true, durationMs: true, createdAt: true }, orderBy: { createdAt: "asc" } },
      feedback: { select: { id: true, step: true, note: true, createdAt: true, user: { select: { name: true } } }, orderBy: { createdAt: "desc" } },
      integrationEvents: { select: INTEGRATION_EVENT_SELECT, orderBy: { createdAt: "desc" }, take: 20 },
    },
  });

  // Older wizards' steps ("brand", "posts"…) count as "Your business".
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
    const completed = b.onboardingStatus === "COMPLETED" ? [...events].reverse().find((e) => e.event === "COMPLETED" && (e.step === "result" || (e.details as { finished?: boolean } | null)?.finished === true)) : undefined;
    const owner = b.members[0]?.user;
    return {
      id: b.id,
      name: b.name,
      avatarUrl: b.avatarUrl,
      owner: owner ? { name: owner.name, email: owner.email, emailVerified: Boolean(owner.emailVerifiedAt) } : null,
      source: lower(b.source),
      status: lower(b.onboardingStatus),
      step: stepId(b.onboardingStep),
      reached: b.onboardingStatus === "COMPLETED" ? ONBOARDING_STEPS[ONBOARDING_STEPS.length - 1] : stepId(furthest),
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
