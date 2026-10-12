import "server-only";
import type { Prisma } from "@/lib/generated/prisma/client";
import { isPriceQuestion } from "@/lib/services/ai";
import type { CompetitorProfile, InstagramComment } from "@/lib/services/instagram";
import type {
  AdminUserDto,
  BusinessSummaryDto,
  CompetitorDto,
  DraftStatus,
  EngagementRuleDto,
  MediaIcon,
  MediaTone,
  PlanId,
  PostGeneratorData,
  PostDraftDto,
  ReplyDraftDto,
  ReplyDraftStatus,
  ScheduledPostDto,
  ScheduledPostStatus,
  UserStatus,
} from "@/types";
import { connectionStatusOf } from "./instagram-account";
import { windowOf } from "@/lib/time";

/**
 * Prisma rows → API DTOs. Every query that feeds these uses an explicit
 * `select` (the constants below), so secrets such as password hashes and
 * tokens are never even loaded.
 */

const lower = <T extends string>(value: T) => value.toLowerCase() as Lowercase<T>;

// Business ---------------------------------------------------------------------

export const BUSINESS_SUMMARY_SELECT = {
  id: true,
  name: true,
  nameAr: true,
  instagramHandle: true,
  category: true,
  categoryAr: true,
  location: true,
  locationAr: true,
  avatarUrl: true,
  plan: true,
  timezone: true,
  instagramConnection: { select: { status: true, tokenExpiresAt: true } },
} satisfies Prisma.BusinessSelect;

export function toBusinessSummary(row: Prisma.BusinessGetPayload<{ select: typeof BUSINESS_SUMMARY_SELECT }>): BusinessSummaryDto {
  return {
    id: row.id,
    name: row.name,
    nameAr: row.nameAr,
    instagramHandle: row.instagramHandle,
    category: row.category,
    categoryAr: row.categoryAr,
    location: row.location,
    locationAr: row.locationAr,
    avatarUrl: row.avatarUrl,
    plan: lower(row.plan) as PlanId,
    timezone: row.timezone,
    connection: connectionStatusOf(row.instagramConnection),
  };
}

// Users ------------------------------------------------------------------------

export const ADMIN_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  avatarUrl: true,
  role: true,
  status: true,
  createdAt: true,
  lastLoginAt: true,
  business: { select: { id: true, name: true, instagramHandle: true } },
} satisfies Prisma.UserSelect;

export function toAdminUser(row: Prisma.UserGetPayload<{ select: typeof ADMIN_USER_SELECT }>): AdminUserDto {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatarUrl,
    role: lower(row.role),
    status: lower(row.status) as UserStatus,
    business: row.business,
    createdAt: row.createdAt.toISOString(),
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
  };
}

// Content ----------------------------------------------------------------------

/** Placeholder media styling for a draft, from its product category. */
export function styleFor(catalog: PostGeneratorData, categoryId: string): { tone: MediaTone; icon: MediaIcon } {
  const category = catalog.categories.find((c) => c.id === categoryId);
  return { tone: category?.tone ?? "sand", icon: category?.icon ?? "sparkles" };
}

export const DRAFT_SELECT = {
  id: true,
  category: true,
  angle: true,
  caption: true,
  language: true,
  status: true,
  createdAt: true,
  imageUrl: true,
  imageSource: true,
  publishError: true,
  author: { select: { id: true, name: true } },
} satisfies Prisma.PostDraftSelect;

export function toDraft(row: Prisma.PostDraftGetPayload<{ select: typeof DRAFT_SELECT }>, catalog: PostGeneratorData): PostDraftDto {
  return {
    ...styleFor(catalog, row.category),
    id: row.id,
    category: row.category,
    angle: row.angle,
    caption: row.caption,
    language: row.language === "en" ? "en" : "ar",
    status: lower(row.status) as DraftStatus,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.author,
    image: row.imageUrl && row.imageSource ? { url: row.imageUrl, source: row.imageSource === "GENERATED" ? "generated" : "uploaded" } : null,
    publishError: row.publishError,
  };
}

export const SCHEDULED_SELECT = {
  id: true,
  draftId: true,
  mediaUrl: true,
  scheduledFor: true,
  status: true,
  publishedMediaId: true,
  draft: { select: { caption: true, category: true, angle: true } },
} satisfies Prisma.ScheduledPostSelect;

export function toScheduled(
  row: Prisma.ScheduledPostGetPayload<{ select: typeof SCHEDULED_SELECT }>,
  timeZone: string,
  catalog: PostGeneratorData,
): ScheduledPostDto {
  return {
    ...styleFor(catalog, row.draft.category),
    source: row.draft.angle === "manual" ? "manual" : "generator",
    id: row.id,
    draftId: row.draftId,
    caption: row.draft.caption,
    mediaUrl: row.mediaUrl,
    scheduledFor: row.scheduledFor.toISOString(),
    window: windowOf(row.scheduledFor, timeZone),
    status: lower(row.status) as ScheduledPostStatus,
    publishedMediaId: row.publishedMediaId,
  };
}

// Engagement & competitors -----------------------------------------------------

export const RULE_SELECT = { id: true, keywords: true, dmMessage: true, active: true, timesTriggered: true } satisfies Prisma.EngagementRuleSelect;

export function toRule(row: Prisma.EngagementRuleGetPayload<{ select: typeof RULE_SELECT }>): EngagementRuleDto {
  return { ...row };
}

export const REPLY_SELECT = {
  id: true,
  commentId: true,
  commentText: true,
  commenterUsername: true,
  commenterAvatarUrl: true,
  draftReply: true,
  status: true,
  createdAt: true,
  reviewer: { select: { id: true, name: true } },
} satisfies Prisma.ReplyDraftSelect;

/** `comment` is the live Instagram comment, when the API still has it. */
export function toReply(row: Prisma.ReplyDraftGetPayload<{ select: typeof REPLY_SELECT }>, comment?: InstagramComment): ReplyDraftDto {
  return {
    postCaption: comment?.mediaCaption ?? "",
    likes: comment?.likes ?? 0,
    language: /[؀-ۿ]/.test(row.draftReply) ? "ar" : "en",
    id: row.id,
    commentId: row.commentId,
    commentText: row.commentText,
    commenterUsername: row.commenterUsername,
    commenterAvatarUrl: row.commenterAvatarUrl,
    draftReply: row.draftReply,
    status: lower(row.status) as ReplyDraftStatus,
    isPriceQuestion: isPriceQuestion(row.commentText),
    createdAt: row.createdAt.toISOString(),
    reviewedBy: row.reviewer,
  };
}

export const COMPETITOR_SELECT = {
  id: true,
  handle: true,
  displayName: true,
  note: true,
  avatarUrl: true,
  followers: true,
  engagementRate: true,
  lastFetchedAt: true,
} satisfies Prisma.CompetitorSelect;

/** Stored row + live profile (falls back to the stored numbers when the profile is unavailable). */
export function toCompetitor(row: Prisma.CompetitorGetPayload<{ select: typeof COMPETITOR_SELECT }>, profile: CompetitorProfile | null): CompetitorDto {
  return {
    ...row,
    lastFetchedAt: row.lastFetchedAt?.toISOString() ?? null,
    name: profile?.name ?? row.handle,
    location: profile?.location ?? "",
    verified: profile?.verified ?? false,
    followerChangePct: profile?.followerChangePct ?? 0,
    postsPerWeek: profile?.postsPerWeek ?? 0,
    recentPosts: profile?.recentPosts ?? [],
    notableNote: profile?.notableNote ?? "",
    engagementHistory: profile?.engagementHistory ?? [],
  };
}
