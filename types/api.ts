/**
 * API contract: response shapes shared by the route handlers and the UI.
 * Every route answers { ok: true, data } or { ok: false, error }.
 * Nothing here ever carries password hashes, tokens or token hashes.
 */
import type { ThemePreference, UiPreferences, Role } from "./auth";
import type { ConnectionStatus, MediaTone } from "./client";
import type { CompetitorPost, TrendingAudio, TrendingTag } from "./competitors";
import type { ProductCategory, Occasion, PostWindow } from "./content";
import type { FollowerPoint, MediaIcon, MetricValue } from "./dashboard";
import type { WindowResult } from "./experiment";
import type { FeatureKey, Permissions, PlanId } from "./permissions";
import type { BrandProfileDto, BusinessSource, OnboardingStatus, OnboardingStepId, PostPurpose } from "./onboarding";
import type { NotificationPrefs } from "./settings";

export type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: ApiErrorBody };

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export type UserStatus = "active" | "suspended";

// ─── Me ──────────────────────────────────────────────────────────────────────

export interface MeDto {
  user: {
    id: string;
    email: string;
    name: string;
    role: Role;
    avatarUrl: string | null;
    uiPreferences: UiPreferences;
    notifications: NotificationPrefs;
    emailVerified: boolean;
  };
  business: BusinessSummaryDto | null;
  /** Effective feature keys (empty for admins). */
  features: FeatureKey[];
}

export type UiPreferencesPatch = Partial<UiPreferences> & { theme?: ThemePreference };

// ─── Business ────────────────────────────────────────────────────────────────

export interface BusinessSummaryDto {
  id: string;
  name: string;
  nameAr: string | null;
  /** Null for a self sign-up that hasn't connected Instagram yet. */
  instagramHandle: string | null;
  category: string | null;
  categoryAr: string | null;
  location: string;
  locationAr: string | null;
  avatarUrl: string | null;
  plan: PlanId;
  timezone: string;
  connection: ConnectionStatus;
}

export interface InstagramConnectionDto {
  status: ConnectionStatus;
  username: string | null;
  connectedAt: string | null;
  tokenExpiresAt: string | null;
  lastSyncAt: string | null;
  /** Which implementation serves this connection; null when there has never been one. */
  provider: InstagramProviderId | null;
  /** How "Connect Instagram" works right now (INSTAGRAM_PROVIDER, and whether Meta is configured). */
  flow: ConnectFlow;
  /** Meta revoked or expired the token: show "Reconnect Instagram". */
  needsReconnect: boolean;
  /** Permissions the user didn't grant (or a call reported missing). */
  missingPermissions: string[];
  /** A Meta sync is running right now. */
  syncing: boolean;
  /** Short reason the last sync failed, e.g. "rate_limited" (never a raw Meta message). */
  lastSyncError: string | null;
}

export type InstagramProviderId = "mock" | "meta";
export type ConnectFlow = "mock" | "meta" | "meta_unavailable";

/** Outcome of Facebook Login, passed back to the page as ?instagram=… */
export type MetaConnectOutcome = "connected" | "cancelled" | "pick" | "no_account" | "taken" | "declined" | "unavailable" | "expired" | "error";

/** A Page + Instagram account offered when one login finds several (no tokens). */
export interface MetaPageOptionDto {
  pageId: string;
  pageName: string;
  igUserId: string;
  username: string;
  name: string | null;
  pictureUrl: string | null;
  followers: number;
  mediaCount: number;
}

export interface IntegrationEventDto {
  id: string;
  level: "error" | "warning" | "info";
  /** e.g. "GET /{ig-user}/media", "oauth.connected", "sync". */
  call: string;
  errorCode: string | null;
  message: string;
  httpStatus: number | null;
  details: unknown;
  createdAt: string;
}

/** Admin client page: the business's Instagram connection and its integration log. */
export interface AdminIntegrationDto {
  connection: {
    provider: InstagramProviderId | null;
    status: "connected" | "needs_reconnect" | "expired" | "disconnected";
    username: string | null;
    connectedAt: string | null;
    tokenExpiresAt: string | null;
    /** Expires within 7 days (or already expired). */
    tokenExpiresSoon: boolean;
    dataAccessExpiresAt: string | null;
    lastSyncAt: string | null;
    lastSyncError: string | null;
    /** Granted permissions (Meta connections). */
    scopes: string[];
    missingPermissions: string[];
    pageName: string | null;
  };
  events: IntegrationEventDto[];
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

export interface InstagramProfileDto {
  username: string;
  followers: number;
  following: number;
  posts: number;
  bio: string;
  website: string;
  postsPublishedToday: number;
}

export interface MediaDto {
  id: string;
  caption: string;
  mediaUrl: string | null;
  /** Reels and videos come back as "video"; mediaUrl is then their thumbnail. */
  mediaType: "image" | "video";
  /** Placeholder styling for mock media without an image. */
  tone: MediaTone;
  icon: MediaIcon;
  likes: number;
  comments: number;
  reach: number;
  saves: number;
  postedAt: string;
}

/** Sections are present only when the matching dashboard feature is ON. */
export interface DashboardDto {
  profile?: InstagramProfileDto;
  metrics?: { reach: MetricValue; engagementRate: MetricValue; followerGrowth: MetricValue; profileVisits: MetricValue };
  followerSeries?: FollowerPoint[];
  topPost?: MediaDto | null;
  quickTiles?: {
    commentsHandledToday?: number;
    repliesAwaitingApproval?: number;
    nextWindow?: { window: PostWindow; start: string; end: string; liftPct: number } | null;
  };
}

// ─── Competitors ─────────────────────────────────────────────────────────────

export interface CompetitorDto {
  id: string;
  handle: string;
  /** Name the business chose; falls back to the profile name in the UI. */
  displayName: string | null;
  /** Free-text label, e.g. "main rival". */
  note: string | null;
  avatarUrl: string | null;
  followers: number;
  engagementRate: number;
  lastFetchedAt: string | null;
  /** Live public-profile details from Instagram. */
  name: string;
  location: string;
  verified: boolean;
  followerChangePct: number;
  postsPerWeek: number;
  recentPosts: CompetitorPost[];
  notableNote: string;
  /** Weekly engagement rate (percent), oldest first. */
  engagementHistory: EngagementPoint[];
}

export interface EngagementPoint {
  /** ISO date (week start). */
  date: string;
  rate: number;
}

export interface TrendsDto {
  audio?: TrendingAudio[];
  tags?: TrendingTag[];
}

// ─── Content ─────────────────────────────────────────────────────────────────

export type DraftStatus = "draft" | "queued" | "published" | "rejected";

export interface PostDraftDto {
  id: string;
  category: string;
  angle: string;
  caption: string;
  language: "en" | "ar";
  status: DraftStatus;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
  /** Placeholder media styling from the product category (shown while there is no image). */
  tone: MediaTone;
  icon: MediaIcon;
  /** The post's image: AI-generated (labelled in the preview) or uploaded by the user. */
  image: { url: string; source: "generated" | "uploaded" } | null;
}

export interface GeneratorOptionsDto {
  categories: ProductCategory[];
  occasions: Occasion[];
  brandVocabulary: string[];
  /** Pre-selected category/occasion (from the brand posts' purposes). */
  defaults: { categoryId: string | null; occasionId: string | null };
  /** The brand profile the AI writes with, when one has been built. */
  brandContext: { version: number; summary: string; purposes: PostPurpose[] } | null;
  /** IMAGE_PROVIDER: "mock" makes placeholder images (test mode). */
  imageProvider: "mock" | "gemini";
}

export type ScheduledPostStatus = "scheduled" | "published" | "cancelled" | "failed";

export interface ScheduledPostDto {
  id: string;
  draftId: string;
  caption: string;
  mediaUrl: string | null;
  scheduledFor: string;
  window: PostWindow;
  status: ScheduledPostStatus;
  publishedMediaId: string | null;
  tone: MediaTone;
  icon: MediaIcon;
  /** "manual" for posts written by hand, else from the Post Generator. */
  source: "generator" | "manual";
}

// ─── Experiment ──────────────────────────────────────────────────────────────

export interface ExperimentDto {
  id: string;
  status: "running" | "paused" | "completed";
  startDate: string;
  daysSampled: number;
  daysPlanned: number;
  dailyTarget: number;
  baselineReach: number;
  windows?: WindowResult[];
  opportunity?: { window: PostWindow; liftPct: number; sampleSize: number; confidencePct: number } | null;
  heatmap?: number[][];
  queue?: ScheduledPostDto[];
}

// ─── Engagement ──────────────────────────────────────────────────────────────

export interface EngagementRuleDto {
  id: string;
  keywords: string[];
  dmMessage: string;
  active: boolean;
  timesTriggered: number;
}

export type ReplyDraftStatus = "pending" | "approved" | "dismissed" | "posted";

export interface ReplyDraftDto {
  id: string;
  commentId: string;
  commentText: string;
  commenterUsername: string;
  commenterAvatarUrl: string | null;
  draftReply: string;
  status: ReplyDraftStatus;
  isPriceQuestion: boolean;
  createdAt: string;
  reviewedBy: { id: string; name: string } | null;
  /** From Instagram: the post the comment is on, and its likes. */
  postCaption: string;
  likes: number;
  /** Language of the drafted reply. */
  language: "en" | "ar";
}

export interface EngagementDto {
  stats: { commentsToday: number; dmsSent: number };
  settings: { autoReply?: boolean; priceQuestionsToWhatsApp?: boolean; whatsappNumber?: string | null };
}

export interface BrandVoiceDto {
  toneLevel: number;
  defaultHashtags: string[];
  brandWords: string[];
  whatsappNumber: string | null;
  priceQuestionsToWhatsApp: boolean;
}

// ─── Admin ───────────────────────────────────────────────────────────────────

export interface AdminOverviewDto {
  businesses: { total: number; byPlan: Record<PlanId, number> };
  users: { total: number; admins: number; active: number; suspended: number };
  connections: Record<ConnectionStatus, number>;
  postsPublishedThisWeek: number;
  postsScheduled: number;
  repliesAwaitingApproval: number;
  commentsHandledThisWeek: number;
}

export interface AdminBusinessDto extends BusinessSummaryDto {
  createdAt: string;
  users: Array<{ id: string; email: string; name: string; status: UserStatus }>;
  enabledFeatures: number;
  totalFeatures: number;
  lastActivityAt: string | null;
  source: BusinessSource;
  onboardingStatus: OnboardingStatus;
  onboardingStep: OnboardingStepId;
  onboardingInvitedAt: string | null;
}

export interface AdminUserDto {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role: Role;
  status: UserStatus;
  business: { id: string; name: string; instagramHandle: string | null } | null;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface PermissionsDto {
  businessId: string;
  plan: PlanId;
  /** Stored ON/OFF value per key. */
  permissions: Permissions;
  /** Effective keys (feature AND its module ON). */
  enabled: FeatureKey[];
  /** Plan preset whose permissions match exactly, if any. */
  matchesPreset: PlanId | null;
}

export interface ActivityLogDto {
  id: string;
  action: string;
  details: unknown;
  createdAt: string;
  business: { id: string; name: string } | null;
  user: { id: string; name: string; role: Role } | null;
}

export interface AdminSystemDto {
  instagramApi: { status: "operational" | "degraded" | "down"; latencyMs: number; uptimePct: number; checkedAt: string };
  webhooks: { status: "operational" | "degraded" | "down"; lastEventAt: string; deliveredToday: number; failedToday: number };
  rateLimits: Array<{ businessId: string; used: number; limit: number; resetsAt: string }>;
}

export interface Paginated<T> {
  items: T[];
  /** Pass as `cursor` to fetch the next page; null on the last page. */
  nextCursor: string | null;
}

/** Read-only snapshot of what a business's user sees. Sections only for enabled features. */
export interface PreviewDto {
  business: BusinessSummaryDto;
  features: FeatureKey[];
  data: {
    dashboard: DashboardDto;
    competitors?: CompetitorDto[];
    trends?: TrendsDto;
    generatorOptions?: GeneratorOptionsDto;
    drafts?: PostDraftDto[];
    scheduledPosts?: ScheduledPostDto[];
    experiment?: ExperimentDto | null;
    engagement?: EngagementDto;
    rules?: EngagementRuleDto[];
    replyDrafts?: ReplyDraftDto[];
    brandVoice?: BrandVoiceDto | null;
    brand: BrandProfileDto;
    instagram: InstagramConnectionDto;
    /** The business user's notification settings (shown read-only). */
    notifications: NotificationPrefs;
  };
}
