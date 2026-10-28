/**
 * API contract: response shapes shared by the route handlers and the UI.
 * Every route answers { ok: true, data } or { ok: false, error }.
 * Nothing here ever carries password hashes, tokens or token hashes.
 */
import type { ThemePreference, UiPreferences, Role } from "./auth";
import type { ConnectionStatus, MediaTone } from "./client";
import type { CompetitorPost, TrendingAudio, TrendingTag } from "./competitors";
import type { ProductCategory, Occasion, PostWindow } from "./content";
import type { MediaIcon } from "./dashboard";
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
export type MetaConnectOutcome = "connected" | "cancelled" | "pick" | "no_account" | "taken" | "already_added" | "declined" | "unavailable" | "expired" | "error" | "not_tester";

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

// ─── Instagram profile and media ─────────────────────────────────────────────

export interface InstagramProfileDto {
  username: string;
  /** The account's display name (a new sign-up's business name comes from it); null when unknown. */
  name?: string | null;
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
  /** Reel / carousel / photo / video (lib/analysis/posts.ts → formatOf); absent = from mediaType. */
  format?: PostFormatDto;
  /** Own posts, when Instagram reports them; null = not available. */
  shares?: number | null;
  views?: number | null;
  permalink?: string | null;
}

export type PostFormatDto = "reel" | "carousel" | "photo" | "video";

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

/** POST /api/ai-chat/similar-post: what makes a competitor's post work and a new post in that style (EN + AR); null = use the sample answer. */
export interface SimilarPostDto {
  topic: { en: string; ar: string };
  style: { en: string; ar: string };
  hook: { en: string; ar: string };
  caption: { en: string; ar: string };
  hashtags: string[];
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
  /** Why the last attempt to publish it failed (a PublishReason), until it's published. */
  publishError: string | null;
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

export type ScheduledPostStatus = "scheduled" | "publishing" | "published" | "cancelled" | "failed";

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

/** A keyword reply rule (comment a keyword → public reply + optional private DM). */
export interface EngagementRuleDto {
  id: string;
  keywords: string[];
  /** "word": the keyword appears as a whole word; "exact": the whole comment is the keyword. */
  matchType: "word" | "exact";
  /** Public reply under the comment ("" only on rules made before keyword replies). */
  commentReply: string;
  /** Private DM to the commenter; "" for none. */
  dmMessage: string;
  scope: "all" | "selected";
  /** Instagram media ids, for scope "selected". */
  mediaIds: string[];
  /** Off: replies wait in the approval queue. */
  autoSend: boolean;
  active: boolean;
  timesTriggered: number;
  lastTriggeredAt: string | null;
  createdAt: string;
}

export type ReplyDraftStatus = "pending" | "approved" | "dismissed" | "posted" | "expired" | "unavailable";
export type ReplyOutcomeDto = "as_is" | "edited" | "manual";

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
  /** "dm": a reply to a direct message (sent privately, within Instagram's 24-hour window). */
  channel: "comment" | "dm";
  /** DM only: when Instagram stops accepting a reply (24 h after the customer's last message). */
  replyBy: string | null;
  /** Keyword reply waiting for approval: the rule's keywords, and the private DM sent with it. */
  keywordRule: { id: string; keywords: string[] } | null;
  privateReply: string | null;
  /** What the AI (or the keyword rule) proposed; differs from draftReply once edited. */
  aiReply: string;
  /** Why it can't be sent any more (shown in the queue until removed), or null. */
  blocked: "dm_window_closed" | "comment_deleted" | null;
  /** Sent replies: as drafted, edited, or written by the business (null for replies sent before this was tracked). */
  outcome: ReplyOutcomeDto | null;
  sentAt: string | null;
}

/** Engagement → Sent: how often replies go out as the AI drafted them, and whether Regenerate can work now. */
export interface ReplySummaryDto {
  days: number;
  /** AI-drafted replies sent in the period, by outcome (keyword replies are counted separately). */
  ai: { as_is: number; edited: number; manual: number };
  keyword: number;
  /** Percentage of AI drafts sent as-is, or null when none were sent. */
  asIsRate: number | null;
  /** False while the AI can't write (not configured, paused, over the daily budget): Regenerate is disabled. */
  regenerate: { available: boolean; reason: string | null };
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
    competitors?: CompetitorDto[];
    trends?: TrendsDto;
    generatorOptions?: GeneratorOptionsDto;
    drafts?: PostDraftDto[];
    scheduledPosts?: ScheduledPostDto[];
    experiment?: ExperimentDto | null;
    engagement?: EngagementDto;
    rules?: EngagementRuleDto[];
    replyDrafts?: ReplyDraftDto[];
    sentReplies?: ReplyDraftDto[];
    replySummary?: ReplySummaryDto;
    competitorAnalysis?: import("./analysis").CompetitorAnalysisDto;
    methods?: import("./analysis").MethodsDto;
    postPerformance?: import("./analysis").PostPerformanceDto;
    /** Post detail for the recent posts (preview opens them read-only). */
    postDetails?: Record<string, import("./analysis").PostDetailDto>;
    /** "Most shared" (postInsights.shareability). */
    shareability?: import("./analysis").ShareabilityDto;
    monitoring?: import("./monitoring").MonitoringDto;
    /** Every monitor in the overview, opened read-only. */
    monitorDetails?: Record<string, import("./monitoring").MonitorDetailDto>;
    /** Statistics for every range. */
    statistics?: Record<string, import("./statistics").StatisticsDto>;
    brandVoice?: BrandVoiceDto | null;
    brand: BrandProfileDto;
    instagram: InstagramConnectionDto;
    /** The business user's notification settings (shown read-only). */
    notifications: NotificationPrefs;
  };
}

// ─── AI strategy recommendations ─────────────────────────────────────────────

export type RecommendationStatusKey = "new" | "accepted" | "dismissed" | "done";

/** What a tip's 7-day result is measured on (interactions / followers only on tips from before the growth signals). */
export type RecommendationMetric = "reach" | "interactions" | "followers" | "shares" | "saves" | "comments";

export interface RecommendationOutcomeDto {
  metric: RecommendationMetric;
  before: number | null;
  after: number | null;
  changePct: number | null;
  verdict: "up" | "down" | "no_clear_change" | "not_enough_data";
  postsBefore: number;
  postsAfter: number;
  evaluatedAt: string;
}

export interface RecommendationDto {
  id: string;
  action: { en: string; ar: string };
  rationale: { en: string; ar: string };
  category: string;
  metric: RecommendationMetric;
  /** Expected impact from the growth signal; null on tips from before the signals. */
  impact: "high" | "medium" | "low" | null;
  confidence: "strong" | "moderate" | "early";
  basedOnPosts: number;
  status: RecommendationStatusKey;
  statusAt: string | null;
  createdAt: string;
  /** Done: when the 7-day comparison is (or was) due. */
  outcomeDueAt: string | null;
  outcome: RecommendationOutcomeDto | null;
}

/** GET /api/recommendations */
export interface RecommendationsDto {
  /** The analysis the current recommendations come from. */
  lastAnalysis: { at: string; trigger: "scheduled" | "manual" } | null;
  /** Last time the data was checked (an unchanged check reuses the last analysis). */
  lastCheckedAt: string | null;
  nextScheduledAt: string | null;
  /** `nextSetAt`: this week's tips are set; a manual refresh can run again from then (null = now). */
  refresh: { used: number; limit: number; nextSetAt: string | null };
  /** New tips from the latest analysis (at most 3), highest impact first. */
  current: RecommendationDto[];
  inProgress: RecommendationDto[];
  done: RecommendationDto[];
  dismissed: RecommendationDto[];
}

/** POST /api/recommendations/refresh */
export interface RecommendationsRefreshDto {
  result: "generated" | "unchanged";
  data: RecommendationsDto;
}

// ─── Notifications ───────────────────────────────────────────────────────────

export interface NotificationDto {
  id: string;
  /** A key of NOTIFICATION_TYPES (lib/notifications.ts); text under notifications.types.<type>. */
  type: "recommendations_ready" | "weekly_report" | "instagram_reconnect" | "post_published" | "post_failed" | "replies_waiting" | "monitor_above" | "monitor_reach_above" | "monitor_below" | "monitor_ended";
  params: Record<string, string | number>;
  href: string;
  read: boolean;
  createdAt: string;
}

/** GET /api/notifications */
export interface NotificationsDto {
  items: NotificationDto[];
  unread: number;
}

// ─── Weekly reports ──────────────────────────────────────────────────────────

/** One number this week vs the week before; null when there's no data for it. */
export interface ReportCompare {
  current: number | null;
  previous: number | null;
  /** Null when either side is missing or the previous value is 0. */
  changePct: number | null;
}

export interface ReportPost {
  postedAt: string;
  type: "image" | "video";
  caption: string;
  likes: number;
  comments: number;
  reach: number;
}

/** Computed in code (lib/services/text/report.ts); the AI only writes the summary. */
export interface WeeklyNumbers {
  periodStart: string;
  periodEnd: string;
  posts: ReportCompare;
  /** Total reach of the week's posts. */
  reach: ReportCompare;
  /** Average likes + comments per post. */
  avgInteractions: ReportCompare;
  /** Average likes + comments per post as a % of current followers. */
  engagementRate: ReportCompare;
  /** Net followers gained in the week. */
  followerChange: ReportCompare;
  followers: number | null;
  top: ReportPost | null;
  weakest: ReportPost | null;
  /** demo: the app's sample data; thin: fewer than 2 posts in one of the weeks. */
  quality: { demo: boolean; thin: boolean };
}

export interface WeeklyReportDto {
  id: string;
  createdAt: string;
  numbers: WeeklyNumbers;
  /** Null when the AI was unavailable: the report has numbers only. */
  summary: { en: string; ar: string } | null;
}
