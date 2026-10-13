import "server-only";
import type { CompetitorPost, TrendingAudio, TrendingTag, FollowerPoint, MetricValue, WindowResult, PostWindow, ServiceHealth } from "@/types";
import type { CompetitorValidation, InstagramProfileDto, MediaDto } from "@/types";
import { MetaInstagramService } from "./instagram.meta";
import { MockInstagramService } from "./instagram.mock";
import type { MessagingFailureReason } from "./meta/messaging";
import type { PublishFailureReason } from "./meta/publish";

/**
 * Instagram data and actions. Routes depend on this interface only.
 *
 * The implementation is chosen PER CONNECTION (`InstagramAccount.provider`):
 * a business connected through Facebook Login uses `MetaInstagramService`
 * (real Graph API, data synced into the database); seeded demo businesses and
 * mock connections keep `MockInstagramService`. INSTAGRAM_PROVIDER only picks
 * the flow "Connect Instagram" uses for NEW connections (lib/services/meta/config.ts).
 */

/** The connected account a call acts for. Built by `getInstagramAccount()` (lib/server/instagram-account.ts). */
export interface InstagramAccount {
  businessId: string;
  igUserId: string | null;
  username: string;
  /** Decrypted access token, or null when disconnected. Never leaves the server. */
  accessToken: string | null;
  /** CONNECTED with an unexpired token. Write calls require it. */
  connected: boolean;
  /** Which implementation serves this account. Accounts that never connected through Meta are "mock". */
  provider: "mock" | "meta";
}

export interface InstagramInsights {
  metrics: { reach: MetricValue; engagementRate: MetricValue; followerGrowth: MetricValue; profileVisits: MetricValue };
  followerSeries: FollowerPoint[];
  /** Average reach per post over the last 30 days. */
  baselineReach: number;
  /** Reach by posting window, from the account's recent posts. */
  windows: WindowResult[];
  opportunity: { window: PostWindow; liftPct: number; sampleSize: number; confidencePct: number } | null;
  /** 7 rows (Sun–Sat) × 24 hours, relative audience activity 0..1. */
  heatmap: number[][];
  commentsToday: number;
  commentsHandledToday: number;
  dmsSentToday: number;
}

export interface InstagramComment {
  id: string;
  username: string;
  avatarUrl: string | null;
  text: string;
  mediaCaption: string;
  postedAt: string;
  likes: number;
}

export interface CompetitorProfile {
  handle: string;
  name: string;
  avatarUrl: string | null;
  location: string;
  verified: boolean;
  followers: number;
  /** Follower change over the last 30 days, percent. */
  followerChangePct: number;
  engagementRate: number;
  postsPerWeek: number;
  recentPosts: CompetitorPost[];
  /** Short description of the most notable recent post. */
  notableNote: string;
  /** Weekly engagement rate over the last ~3 months, oldest first. */
  engagementHistory: Array<{ date: string; rate: number }>;
  /** Total posts on the account (Meta business discovery). */
  mediaCount?: number;
}

/** Result of the OAuth exchange when a business connects its account. */
export interface ConnectedAccount {
  igUserId: string;
  username: string;
  accessToken: string;
  expiresAt: Date;
}

export interface ApiHealth {
  instagramApi: { status: ServiceHealth; latencyMs: number; uptimePct: number; checkedAt: string };
  webhooks: { status: ServiceHealth; lastEventAt: string; deliveredToday: number; failedToday: number };
}

export interface RateLimitUsage {
  used: number;
  limit: number;
  resetsAt: string;
}

export interface InstagramTrends {
  audio: TrendingAudio[];
  tags: TrendingTag[];
}

/**
 * Whether another account can be tracked as a competitor. Only business and
 * creator accounts expose their data to the Graph API (business discovery).
 *  - ready:        public business/creator account — `profile` is set
 *  - not_business: personal account, its data can't be read
 *  - private:      private account
 *  - not_found:    no account with that handle
 *  - own_account:  the business's own account
 */
export interface BusinessAccountLookup {
  status: CompetitorValidation;
  profile: CompetitorProfile | null;
}

export interface InstagramService {
  getProfile(account: InstagramAccount): Promise<InstagramProfileDto>;
  getInsights(account: InstagramAccount): Promise<InstagramInsights>;
  /** Recent media, best-performing first (images, carousels and reels; reels have mediaType "video"). */
  getMedia(account: InstagramAccount, options?: { limit?: number }): Promise<MediaDto[]>;
  getComments(account: InstagramAccount): Promise<InstagramComment[]>;
  replyToComment(account: InstagramAccount, commentId: string, text: string): Promise<{ id: string }>;
  /**
   * Private reply: a DM to the author of a comment, addressed by the comment id (keyword
   * replies). Instagram allows one per comment, within 7 days of it. Throws
   * InstagramMessagingError (already_replied, window_closed, comment_unavailable, …),
   * InstagramNotConnectedError, InstagramPermissionError or InstagramRateLimitedError.
   */
  sendPrivateReply(account: InstagramAccount, commentId: string, text: string): Promise<{ id: string }>;
  /**
   * Replies in an existing Instagram DM conversation. `recipientId` is the customer's
   * Instagram-scoped id from the messaging webhook. Throws InstagramMessagingError
   * (window closed, recipient unavailable, rejected), InstagramNotConnectedError,
   * InstagramPermissionError or InstagramRateLimitedError.
   */
  replyToMessage(account: InstagramAccount, recipientId: string, text: string): Promise<{ id: string }>;
  /** Username and picture of the person behind an Instagram-scoped id, or null when unknown. */
  getMessagingProfile(account: InstagramAccount, recipientId: string): Promise<{ username: string | null; avatarUrl: string | null } | null>;
  /**
   * Publishes one image with its caption. The real implementation needs `mediaUrl`
   * to be a public HTTPS JPEG (lib/server/publishing.ts prepares one) and throws
   * InstagramPublishError, InstagramNotConnectedError, InstagramPermissionError
   * or InstagramRateLimitedError.
   */
  publishPost(account: InstagramAccount, post: { caption: string; mediaUrl: string | null }): Promise<{ mediaId: string }>;
  /** Public profile of another account; null when it doesn't exist. */
  getCompetitorProfile(account: InstagramAccount, handle: string): Promise<CompetitorProfile | null>;
  /**
   * Checks whether a handle can be tracked as a competitor (see BusinessAccountLookup).
   * Works without a connection during onboarding: the real implementation uses
   * the platform app's token for business discovery when the business has none.
   */
  lookupBusinessAccount(account: InstagramAccount, handle: string): Promise<BusinessAccountLookup>;
  /** Trending audio and hashtags/keywords in the account's market. */
  getTrends(account: InstagramAccount): Promise<InstagramTrends>;
  /**
   * Completes the OAuth flow for a business. The real implementation exchanges
   * the authorization code from Instagram's redirect; the mock approves at once.
   */
  connectAccount(request: { businessId: string; handle: string; code?: string }): Promise<ConnectedAccount>;
  /** Platform-level health of the Instagram API and webhooks. */
  getApiHealth(): Promise<ApiHealth>;
  /** API calls used by an account in the current rate-limit window. */
  getRateLimitUsage(account: InstagramAccount): Promise<RateLimitUsage>;
}

/** Thrown by write calls when the business has no working connection. */
export class InstagramNotConnectedError extends Error {
  constructor() {
    super("Instagram account is not connected.");
  }
}

/** Thrown by Meta calls whose permission the user didn't grant. */
export class InstagramPermissionError extends Error {
  constructor(readonly permissions: string[]) {
    super(`Instagram permission missing: ${permissions.join(", ") || "unknown"}.`);
  }
}

/**
 * Thrown by `publishPost` when Instagram won't publish this post. `image_not_public`:
 * the image URL isn't public HTTPS (e.g. STORAGE_PROVIDER=local), so Meta can't fetch it.
 */
export class InstagramPublishError extends Error {
  constructor(
    readonly reason: PublishFailureReason | "image_not_public",
    /** Meta's own wording (English), for the integration log. */
    readonly detail = "",
  ) {
    super(`Instagram couldn't publish the post (${reason}).`);
  }
}

/** Thrown by `replyToMessage` when Instagram didn't deliver the DM. */
export class InstagramMessagingError extends Error {
  constructor(
    readonly reason: MessagingFailureReason,
    /** Meta's own wording (English), for the integration log. */
    readonly detail = "",
  ) {
    super(`Instagram didn't deliver the message (${reason}).`);
  }
}

/** Thrown when Meta asked us to slow down; `retryAfterMs` when known. */
export class InstagramRateLimitedError extends Error {
  constructor(readonly retryAfterMs: number | null) {
    super("Instagram asked us to slow down. Try again later.");
  }
}

/** Sends each call to the implementation of the account it acts for. */
class RoutingInstagramService implements InstagramService {
  constructor(
    private readonly mock: InstagramService,
    private readonly meta: InstagramService,
  ) {}

  private for(account: InstagramAccount) {
    return account.provider === "meta" ? this.meta : this.mock;
  }

  getProfile(account: InstagramAccount) {
    return this.for(account).getProfile(account);
  }
  getInsights(account: InstagramAccount) {
    return this.for(account).getInsights(account);
  }
  getMedia(account: InstagramAccount, options?: { limit?: number }) {
    return this.for(account).getMedia(account, options);
  }
  getComments(account: InstagramAccount) {
    return this.for(account).getComments(account);
  }
  replyToComment(account: InstagramAccount, commentId: string, text: string) {
    return this.for(account).replyToComment(account, commentId, text);
  }
  sendPrivateReply(account: InstagramAccount, commentId: string, text: string) {
    return this.for(account).sendPrivateReply(account, commentId, text);
  }
  replyToMessage(account: InstagramAccount, recipientId: string, text: string) {
    return this.for(account).replyToMessage(account, recipientId, text);
  }
  getMessagingProfile(account: InstagramAccount, recipientId: string) {
    return this.for(account).getMessagingProfile(account, recipientId);
  }
  publishPost(account: InstagramAccount, post: { caption: string; mediaUrl: string | null }) {
    return this.for(account).publishPost(account, post);
  }
  getCompetitorProfile(account: InstagramAccount, handle: string) {
    return this.for(account).getCompetitorProfile(account, handle);
  }
  lookupBusinessAccount(account: InstagramAccount, handle: string) {
    return this.for(account).lookupBusinessAccount(account, handle);
  }
  getTrends(account: InstagramAccount) {
    return this.for(account).getTrends(account);
  }
  /** Mock flow only — Meta connections go through Facebook Login (app/api/integrations/instagram). */
  connectAccount(request: { businessId: string; handle: string; code?: string }) {
    return this.mock.connectAccount(request);
  }
  /** Platform-level status (mock until a real health check exists). */
  getApiHealth() {
    return this.mock.getApiHealth();
  }
  getRateLimitUsage(account: InstagramAccount) {
    return this.for(account).getRateLimitUsage(account);
  }
}

let instance: InstagramService | null = null;

export function getInstagramService(): InstagramService {
  if (!instance) {
    const mock = new MockInstagramService();
    instance = new RoutingInstagramService(mock, new MetaInstagramService(mock));
  }
  return instance;
}
