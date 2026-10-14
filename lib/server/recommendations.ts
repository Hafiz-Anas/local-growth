import "server-only";
import { db } from "@/lib/db";
import { Prisma, type RecommendationConfidence, type RecommendationStatus } from "@/lib/generated/prisma/client";
import { isFeatureEnabled, permissionsFromRows } from "@/lib/permissions";
import { getAIService } from "@/lib/services/ai";
import { formatFacts } from "@/lib/services/text/assistant";
import type { TextFailureReason } from "@/lib/services/text/errors";
import {
  OUTCOME_DAYS,
  compareOutcome,
  outcomeBaseline,
  outcomeSummary,
  strategyInputHash,
  type OutcomeBaseline,
  type OutcomeResult,
  type StrategyDecision,
} from "@/lib/services/text/strategy";
import type { RecommendationDto, RecommendationStatusKey, RecommendationsDto } from "@/types";
import { gatherAssistantFacts } from "./assistant";
import { ApiError, notFound } from "./http";

/**
 * AI strategy recommendations per business: a weekly analysis (cron) or a
 * manual refresh reads the same data block as the assistant, skips the AI
 * when nothing changed (input hash), and stores 3–5 recommendations. The
 * owner's decisions feed the next analysis; Done ones get a 7-day outcome.
 */

/** Manual refreshes that reach the AI, per business per rolling 24 hours. */
export const RECOMMENDATION_REFRESH_LIMIT = 3;
const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;
/** Businesses analysed per cron run (the run also stops after ~4 minutes). */
const CRON_BATCH = Math.max(1, Number.parseInt(process.env.RECOMMENDATIONS_CRON_BATCH ?? "", 10) || 10);

const CONFIDENCE_TO_DB: Record<"strong" | "moderate" | "early", RecommendationConfidence> = { strong: "STRONG", moderate: "MODERATE", early: "EARLY" };
const lower = <T extends string>(v: T) => v.toLowerCase() as Lowercase<T>;

const REC_SELECT = {
  id: true,
  actionEn: true,
  actionAr: true,
  rationaleEn: true,
  rationaleAr: true,
  category: true,
  metric: true,
  confidence: true,
  basedOnPosts: true,
  status: true,
  statusAt: true,
  outcome: true,
  createdAt: true,
} as const;
type RecRow = Prisma.RecommendationGetPayload<{ select: typeof REC_SELECT }>;

function toDto(row: RecRow): RecommendationDto {
  return {
    id: row.id,
    action: { en: row.actionEn, ar: row.actionAr },
    rationale: { en: row.rationaleEn, ar: row.rationaleAr },
    category: row.category,
    metric: row.metric as RecommendationDto["metric"],
    confidence: lower(row.confidence),
    basedOnPosts: row.basedOnPosts,
    status: lower(row.status),
    statusAt: row.statusAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    outcomeDueAt: row.status === "DONE" && row.statusAt ? new Date(row.statusAt.getTime() + OUTCOME_DAYS * DAY).toISOString() : null,
    outcome: (row.outcome as RecommendationDto["outcome"]) ?? null,
  };
}

async function manualRefreshesToday(businessId: string): Promise<number> {
  return db.recommendationRun.count({ where: { businessId, trigger: "MANUAL", unchanged: false, createdAt: { gte: new Date(Date.now() - DAY) } } });
}

export async function getRecommendations(businessId: string): Promise<RecommendationsDto> {
  await evaluateDueOutcomes(businessId);
  const [latest, analysis, used, decided, accepted] = await Promise.all([
    db.recommendationRun.findFirst({ where: { businessId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    db.recommendationRun.findFirst({ where: { businessId, unchanged: false }, orderBy: { createdAt: "desc" }, select: { id: true, createdAt: true, trigger: true } }),
    manualRefreshesToday(businessId),
    db.recommendation.findMany({ where: { businessId, status: { in: ["DONE", "DISMISSED"] } }, orderBy: { statusAt: "desc" }, take: 40, select: REC_SELECT }),
    db.recommendation.findMany({ where: { businessId, status: "ACCEPTED" }, orderBy: { statusAt: "desc" }, select: REC_SELECT }),
  ]);
  const current = analysis ? await db.recommendation.findMany({ where: { runId: analysis.id, status: "NEW" }, orderBy: { createdAt: "asc" }, select: REC_SELECT }) : [];
  return {
    lastAnalysis: analysis ? { at: analysis.createdAt.toISOString(), trigger: lower(analysis.trigger) } : null,
    lastCheckedAt: latest?.createdAt.toISOString() ?? null,
    nextScheduledAt: latest ? new Date(latest.createdAt.getTime() + WEEK).toISOString() : null,
    refresh: { used, limit: RECOMMENDATION_REFRESH_LIMIT },
    current: current.map(toDto),
    inProgress: accepted.map(toDto),
    done: decided.filter((r) => r.status === "DONE").slice(0, 20).map(toDto),
    dismissed: decided.filter((r) => r.status === "DISMISSED").slice(0, 20).map(toDto),
  };
}

/** What the owner did with earlier recommendations (newest first), for the next analysis. */
async function pastDecisions(businessId: string): Promise<StrategyDecision[]> {
  const rows = await db.recommendation.findMany({
    where: { businessId, status: { in: ["ACCEPTED", "DISMISSED", "DONE"] } },
    orderBy: { statusAt: "desc" },
    take: 25,
    select: { status: true, statusAt: true, actionEn: true, outcome: true },
  });
  return rows.map((r) => ({
    status: lower(r.status) as StrategyDecision["status"],
    at: (r.statusAt ?? new Date(0)).toISOString(),
    action: r.actionEn,
    outcome: r.outcome ? outcomeSummary(r.outcome as unknown as OutcomeResult) : null,
  }));
}

export type GenerateResult = { result: "generated" } | { result: "unchanged" } | { result: "no_data" } | { result: "unavailable"; reason: TextFailureReason };

/** One analysis. Unchanged input → a cheap "unchanged" run (no AI call); no Instagram data → nothing. */
export async function generateRecommendations(businessId: string, trigger: "SCHEDULED" | "MANUAL", options: { userId?: string; withCompetitors: boolean }): Promise<GenerateResult> {
  const facts = await gatherAssistantFacts(businessId, "strategy", { withCompetitors: options.withCompetitors });
  if (facts.instagram.status === "not_connected") return { result: "no_data" };
  const decisions = await pastDecisions(businessId);
  const inputHash = strategyInputHash(facts, decisions);

  const last = await db.recommendationRun.findFirst({ where: { businessId }, orderBy: { createdAt: "desc" }, select: { inputHash: true } });
  if (last?.inputHash === inputHash) {
    await db.recommendationRun.create({ data: { businessId, trigger, inputHash, unchanged: true, userId: options.userId ?? null } });
    return { result: "unchanged" };
  }

  const business = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { name: true, nameAr: true } });
  const answer = await getAIService().strategy({
    businessId,
    prompt: { businessName: business.name, businessNameAr: business.nameAr, facts: formatFacts(facts, "strategy"), decisions },
  });
  if (!answer.ok) return { result: "unavailable", reason: answer.reason };

  await db.recommendationRun.create({
    data: {
      businessId,
      trigger,
      inputHash,
      userId: options.userId ?? null,
      recommendations: {
        create: answer.recommendations.map((r) => ({
          businessId,
          actionEn: r.actionEn,
          actionAr: r.actionAr,
          rationaleEn: r.rationaleEn,
          rationaleAr: r.rationaleAr,
          category: r.category,
          metric: r.metric,
          confidence: CONFIDENCE_TO_DB[r.confidence],
          basedOnPosts: r.basedOnPosts,
        })),
      },
    },
  });
  return { result: "generated" };
}

/** POST /api/recommendations/refresh: a manual analysis within the daily limit. */
export async function refreshRecommendations(businessId: string, userId: string, withCompetitors: boolean): Promise<"generated" | "unchanged"> {
  if ((await manualRefreshesToday(businessId)) >= RECOMMENDATION_REFRESH_LIMIT) {
    throw new ApiError(429, "recommendations_limit", `Recommendations can be refreshed ${RECOMMENDATION_REFRESH_LIMIT} times a day.`);
  }
  const outcome = await generateRecommendations(businessId, "MANUAL", { userId, withCompetitors });
  if (outcome.result === "no_data") throw new ApiError(409, "instagram_not_connected", "Connect Instagram to get recommendations.");
  if (outcome.result === "unavailable") {
    throw new ApiError(503, "recommendations_unavailable", "The AI can't analyse your account right now.", [{ path: "reason", message: outcome.reason }]);
  }
  return outcome.result;
}

// ─── Decisions and outcomes ──────────────────────────────────────────────────

const ALLOWED: Record<RecommendationStatus, RecommendationStatus[]> = {
  NEW: ["ACCEPTED", "DISMISSED", "DONE"],
  ACCEPTED: ["NEW", "DISMISSED", "DONE"],
  DISMISSED: ["NEW"],
  DONE: [],
};

/** Accept / dismiss / done (and undo back to new). Done stores the baseline for the 7-day comparison. */
export async function setRecommendationStatus(businessId: string, id: string, status: RecommendationStatusKey, userId: string): Promise<RecommendationDto> {
  const row = await db.recommendation.findFirst({ where: { id, businessId }, select: { status: true } });
  if (!row) throw notFound("Recommendation");
  const next = status.toUpperCase() as RecommendationStatus;
  if (next === row.status) throw new ApiError(409, "conflict", "The recommendation already has that status.");
  if (!ALLOWED[row.status].includes(next)) throw new ApiError(409, "conflict", `A ${lower(row.status)} recommendation can't be marked ${status}.`);

  const now = new Date();
  let baseline: OutcomeBaseline | undefined;
  if (next === "DONE") {
    const facts = await gatherAssistantFacts(businessId, "post");
    baseline = outcomeBaseline(facts.posts ?? [], facts.profile?.followers ?? null, now);
  }
  const updated = await db.recommendation.update({
    where: { id },
    data: { status: next, statusAt: now, statusBy: userId, ...(baseline && { baseline: baseline as unknown as Prisma.InputJsonObject }) },
    select: REC_SELECT,
  });
  return toDto(updated);
}

/** Done recommendations whose 7 days are over get their before/after comparison. */
export async function evaluateDueOutcomes(businessId: string): Promise<number> {
  const due = await db.recommendation.findMany({
    where: { businessId, status: "DONE", outcome: { equals: Prisma.DbNull }, statusAt: { lte: new Date(Date.now() - OUTCOME_DAYS * DAY) } },
    select: { id: true, metric: true, baseline: true },
  });
  if (!due.length) return 0;
  const facts = await gatherAssistantFacts(businessId, "post");
  const now = new Date();
  for (const rec of due) {
    const baseline = rec.baseline as unknown as OutcomeBaseline | null;
    if (!baseline) continue;
    const outcome = compareOutcome(rec.metric as OutcomeResult["metric"], baseline, facts.posts ?? [], facts.profile?.followers ?? null, now);
    await db.recommendation.update({ where: { id: rec.id }, data: { outcome: outcome as unknown as Prisma.InputJsonObject, outcomeAt: now } });
  }
  return due.length;
}

// ─── Weekly sweep (cron) ─────────────────────────────────────────────────────

export interface SweepSummary {
  due: number;
  generated: number;
  unchanged: number;
  noData: number;
  failed: number;
  outcomes: number;
  stoppedEarly: boolean;
}

/** GET /api/cron/recommendations: analyses businesses whose last analysis is a week old, oldest first. */
export async function runRecommendationSweep(deadlineMs = 240_000): Promise<SweepSummary> {
  const started = Date.now();
  const summary: SweepSummary = { due: 0, generated: 0, unchanged: 0, noData: 0, failed: 0, outcomes: 0, stoppedEarly: false };

  const pending = await db.recommendation.findMany({
    where: { status: "DONE", outcome: { equals: Prisma.DbNull }, statusAt: { lte: new Date(Date.now() - OUTCOME_DAYS * DAY) } },
    distinct: ["businessId"],
    select: { businessId: true },
  });
  for (const { businessId } of pending) summary.outcomes += await evaluateDueOutcomes(businessId);

  const businesses = await db.business.findMany({
    where: { onboardingStatus: "COMPLETED", permissions: { some: { featureKey: "recommendations", enabled: true } } },
    select: {
      id: true,
      permissions: { select: { featureKey: true, enabled: true } },
      recommendationRuns: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
    },
  });
  const due = businesses
    .filter((b) => isFeatureEnabled(permissionsFromRows(b.permissions), "recommendations"))
    .map((b) => ({ ...b, last: b.recommendationRuns[0]?.createdAt.getTime() ?? 0 }))
    .filter((b) => Date.now() - b.last >= WEEK)
    .sort((a, b) => a.last - b.last);
  summary.due = due.length;

  let calls = 0;
  for (const business of due) {
    // Only analyses that reach the AI count toward the batch (unchanged / no-data checks are cheap).
    if (calls >= CRON_BATCH || Date.now() - started > deadlineMs) {
      summary.stoppedEarly = true;
      break;
    }
    const permissions = permissionsFromRows(business.permissions);
    const outcome = await generateRecommendations(business.id, "SCHEDULED", { withCompetitors: isFeatureEnabled(permissions, "competitors") });
    if (outcome.result === "generated" || outcome.result === "unavailable") calls += 1;
    if (outcome.result === "generated") summary.generated += 1;
    else if (outcome.result === "unchanged") summary.unchanged += 1;
    else if (outcome.result === "no_data") summary.noData += 1;
    else {
      summary.failed += 1;
      // Out of budget or misconfigured: the rest would fail the same way. They stay due for the next run.
      if (outcome.reason !== "bad_output" && outcome.reason !== "blocked") {
        summary.stoppedEarly = true;
        break;
      }
    }
  }
  return summary;
}
