import "server-only";
import { EXPERIMENT_DAYS } from "@/config/schedule";
import { db } from "@/lib/db";
import type { DraftStatus, ReplyDraftStatus, ScheduledPostStatus } from "@/lib/generated/prisma/client";
import { isFeatureEnabled } from "@/lib/permissions";
import { getContentCatalog } from "@/lib/services/catalog";
import { imageProvider } from "@/lib/services/image";
import { catalogProfile, currentBrandContext } from "./brand";
import { getInstagramService } from "@/lib/services/instagram";
import type {
  BrandVoiceDto,
  BusinessSummaryDto,
  CompetitorDto,
  EngagementDto,
  EngagementRuleDto,
  ExperimentDto,
  GeneratorOptionsDto,
  Permissions,
  PostDraftDto,
  ReplyDraftDto,
  ScheduledPostDto,
  TrendsDto,
} from "@/types";
import {
  BUSINESS_SUMMARY_SELECT,
  COMPETITOR_SELECT,
  DRAFT_SELECT,
  REPLY_SELECT,
  RULE_SELECT,
  SCHEDULED_SELECT,
  toBusinessSummary,
  toCompetitor,
  toDraft,
  toReply,
  toRule,
  toScheduled,
} from "./dto";
import { notFound } from "./http";
import { competitorProfileFor } from "./competitor-profiles";
import { getInstagramAccount } from "./instagram-account";
import { expireClosedDmDrafts } from "./instagram-dm";
import { queueWhere } from "./replies";

/**
 * Business-scoped reads. Every function takes the businessId from the caller's
 * guard (the session, or an admin route param) — never from request input —
 * and returns only the sections whose features are ON.
 */

const DAY = 24 * 60 * 60 * 1000;
const on = (permissions: Permissions, key: Parameters<typeof isFeatureEnabled>[1]) => isFeatureEnabled(permissions, key);

export async function getBusinessSummary(businessId: string): Promise<BusinessSummaryDto> {
  const row = await db.business.findUnique({ where: { id: businessId }, select: BUSINESS_SUMMARY_SELECT });
  if (!row) throw notFound("Business");
  return toBusinessSummary(row);
}

async function timezoneOf(businessId: string): Promise<string> {
  const row = await db.business.findUnique({ where: { id: businessId }, select: { timezone: true } });
  if (!row) throw notFound("Business");
  return row.timezone;
}

/** Product catalogue of a business (categories give drafts their placeholder styling). */
export async function catalogFor(businessId: string) {
  const row = await db.business.findUnique({ where: { id: businessId }, select: { name: true } });
  if (!row) throw notFound("Business");
  return getContentCatalog(businessId, row.name, await catalogProfile(businessId));
}

// Competitors ------------------------------------------------------------------

/** Tracked competitors: only accounts that validated as Ready (onboarding keeps the others with their reason). */
export async function listCompetitors(businessId: string): Promise<CompetitorDto[]> {
  const rows = await db.competitor.findMany({ where: { businessId, validationStatus: "READY" }, select: COMPETITOR_SELECT, orderBy: { followers: "desc" } });
  const account = await getInstagramAccount(businessId);
  const profiles = await Promise.all(rows.map((row) => competitorProfileFor(account, row)));
  return rows.map((row, i) => toCompetitor(row, profiles[i]));
}

export async function getTrends(businessId: string, permissions: Permissions): Promise<TrendsDto> {
  const trends = await getInstagramService().getTrends(await getInstagramAccount(businessId));
  const dto: TrendsDto = {};
  if (on(permissions, "competitors.trendingAudio")) dto.audio = trends.audio;
  if (on(permissions, "competitors.trendingHashtags")) dto.tags = trends.tags;
  return dto;
}

// Content ----------------------------------------------------------------------

/**
 * Generator choices. With a brand profile the business isn't asked for the
 * same inputs again: occasions come from its post purposes (most used first,
 * pre-selected) and the AI writes with the brand context.
 */
export async function getGeneratorOptions(businessId: string, permissions: Permissions): Promise<GeneratorOptionsDto> {
  const business = await db.business.findUnique({ where: { id: businessId }, select: { name: true, brandVoice: { select: { brandWords: true } } } });
  if (!business) throw notFound("Business");
  const [profile, context] = await Promise.all([catalogProfile(businessId), currentBrandContext(businessId)]);
  const catalog = getContentCatalog(businessId, business.name, profile);
  const usedPurpose = profile.purposes.find((p) => catalog.occasions.some((o) => o.id === p)) ?? null;
  return {
    categories: catalog.categories,
    occasions: catalog.occasions,
    brandVocabulary: on(permissions, "postGenerator.brandVocabulary") ? (business.brandVoice?.brandWords ?? catalog.brandVocabulary) : [],
    defaults: { categoryId: catalog.categories[0]?.id ?? null, occasionId: usedPurpose },
    brandContext: context && { version: context.version, summary: context.summary, purposes: [...new Set(context.purposePatterns.map((p) => p.purpose))] },
    imageProvider: imageProvider(),
  };
}

export async function listDrafts(businessId: string, status?: DraftStatus): Promise<PostDraftDto[]> {
  const rows = await db.postDraft.findMany({
    where: { businessId, ...(status ? { status } : { status: { in: ["DRAFT", "QUEUED"] } }) },
    select: DRAFT_SELECT,
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const catalog = await catalogFor(businessId);
  return rows.map((row) => toDraft(row, catalog));
}

export async function listScheduled(businessId: string, status: ScheduledPostStatus = "SCHEDULED"): Promise<ScheduledPostDto[]> {
  const [timezone, catalog] = await Promise.all([timezoneOf(businessId), catalogFor(businessId)]);
  const rows = await db.scheduledPost.findMany({
    where: { businessId, status },
    select: SCHEDULED_SELECT,
    orderBy: { scheduledFor: status === "SCHEDULED" ? "asc" : "desc" },
    take: 100,
  });
  return rows.map((row) => toScheduled(row, timezone, catalog));
}

// Experiment -------------------------------------------------------------------

export async function getExperiment(businessId: string, permissions: Permissions): Promise<ExperimentDto | null> {
  const experiment = await db.postingExperiment.findFirst({
    where: { businessId },
    orderBy: [{ status: "asc" }, { startDate: "desc" }], // RUNNING sorts first
    select: { id: true, status: true, startDate: true, dailyTarget: true },
  });
  if (!experiment) return null;

  const insights = await getInstagramService().getInsights(await getInstagramAccount(businessId));
  const daysSampled = Math.min(EXPERIMENT_DAYS, Math.max(0, Math.floor((Date.now() - experiment.startDate.getTime()) / DAY)));
  const dto: ExperimentDto = {
    id: experiment.id,
    status: experiment.status.toLowerCase() as ExperimentDto["status"],
    startDate: experiment.startDate.toISOString(),
    daysSampled,
    daysPlanned: EXPERIMENT_DAYS,
    dailyTarget: experiment.dailyTarget,
    baselineReach: insights.baselineReach,
  };
  if (on(permissions, "experiment.windows")) {
    dto.windows = insights.windows;
    dto.opportunity = insights.opportunity;
  }
  if (on(permissions, "experiment.heatmap")) dto.heatmap = insights.heatmap;
  if (on(permissions, "experiment.scheduleQueue")) dto.queue = await listScheduled(businessId);
  return dto;
}

// Engagement -------------------------------------------------------------------

export async function getEngagement(businessId: string, permissions: Permissions): Promise<EngagementDto> {
  const [insights, voice] = await Promise.all([
    getInstagramService().getInsights(await getInstagramAccount(businessId)),
    db.brandVoice.findUnique({ where: { businessId }, select: { autoReply: true, priceQuestionsToWhatsApp: true, whatsappNumber: true } }),
  ]);
  const settings: EngagementDto["settings"] = {};
  if (on(permissions, "engagement.autoReply")) settings.autoReply = voice?.autoReply ?? false;
  if (on(permissions, "engagement.whatsappPricing")) {
    settings.priceQuestionsToWhatsApp = voice?.priceQuestionsToWhatsApp ?? false;
    settings.whatsappNumber = voice?.whatsappNumber ?? null;
  }
  return { stats: { commentsToday: insights.commentsToday, dmsSent: insights.dmsSentToday }, settings };
}

export async function listRules(businessId: string): Promise<EngagementRuleDto[]> {
  const rows = await db.engagementRule.findMany({ where: { businessId }, select: RULE_SELECT, orderBy: [{ active: "desc" }, { createdAt: "asc" }] });
  return rows.map(toRule);
}

/** The approval queue; `kinds` limits it to AI drafts and/or keyword reply drafts (lib/server/replies.ts). */
export async function listReplies(businessId: string, status: ReplyDraftStatus = "PENDING", kinds = { ai: true, keyword: true }): Promise<ReplyDraftDto[]> {
  if (!kinds.ai && !kinds.keyword) return [];
  // DM drafts past Instagram's 24-hour reply window can't be sent any more.
  await expireClosedDmDrafts(businessId);
  const rows = await db.replyDraft.findMany({
    where: queueWhere(businessId, status, kinds),
    select: REPLY_SELECT,
    orderBy: status === "POSTED" ? [{ sentAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }] : { createdAt: "desc" },
    take: status === "POSTED" ? 50 : 100,
  });
  const comments = await getInstagramService()
    .getComments(await getInstagramAccount(businessId))
    .catch(() => []);
  const byId = new Map(comments.map((c) => [c.id, c]));
  return rows.map((row) => toReply(row, byId.get(row.commentId)));
}

// Settings ---------------------------------------------------------------------

export async function getBrandVoice(businessId: string): Promise<BrandVoiceDto | null> {
  const row = await db.brandVoice.findUnique({
    where: { businessId },
    select: { toneLevel: true, defaultHashtags: true, brandWords: true, whatsappNumber: true, priceQuestionsToWhatsApp: true },
  });
  return row;
}
