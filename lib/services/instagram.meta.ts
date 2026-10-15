import "server-only";
import { db } from "@/lib/db";
import { coolingDown, graphFor, usageFor } from "@/lib/server/meta-client";
import { toneFor } from "@/lib/utils";
import type { InstagramProfileDto, MediaDto, MediaIcon } from "@/types";
import {
  InstagramMessagingError,
  InstagramNotConnectedError,
  InstagramPermissionError,
  InstagramPublishError,
  InstagramRateLimitedError,
  type ApiHealth,
  type BusinessAccountLookup,
  type CompetitorProfile,
  type ConnectedAccount,
  type InstagramAccount,
  type InstagramComment,
  type InstagramInsights,
  type InstagramService,
  type InstagramTrends,
  type RateLimitUsage,
} from "./instagram";
import { businessDiscovery, postCommentReply } from "./meta/api";
import { MetaApiError, isMetaError } from "./meta/errors";
import { MetaMessagingError, fetchMessagingProfile, sendPrivateReply, sendTextMessage } from "./meta/messaging";
import { MetaPublishError, isPublicHttpsUrl, publishImage } from "./meta/publish";
import { accountMetric, engagementMetric, followerGrowthMetric, followerSeries, heatmapOf, opportunityOf, windowResults, type SyncedPost } from "./meta/insights";
import { displayUrl, mapDiscoveryOutcome, type AccountInsights, type DiscoveredProfile, type StoredProfile } from "./meta/mappers";

/**
 * REAL Instagram through Meta's Graph API ("Instagram API with Facebook Login").
 *
 * Reads (profile, media, insights, comments) come from the database, filled by
 * the sync (lib/server/instagram-sync.ts) — pages never call Meta on load.
 * Live calls: replying to a comment, replying to a direct message (DMs arrive
 * through the messaging webhook, lib/server/instagram-dm.ts), private replies to
 * commenters (keyword replies, lib/server/keyword-replies.ts), business discovery
 * (competitors) and publishing (single image + caption, lib/services/meta/publish.ts).
 *
 * Not available, and labelled in the UI:
 *  - Trends: the Graph API has no trending audio/hashtags → empty.
 */

const DAY = 24 * 60 * 60 * 1000;
const ICONS: MediaIcon[] = ["sparkles", "gift", "cup", "bag", "gem", "cake"];

function requireConnection(account: InstagramAccount): { igUserId: string; token: string } {
  if (!account.connected || !account.igUserId || !account.accessToken) throw new InstagramNotConnectedError();
  return { igUserId: account.igUserId, token: account.accessToken };
}

/** Graph failures → the service's errors the routes already understand. */
function translate(error: unknown): never {
  if (error instanceof MetaApiError) {
    if (error.kind === "token_invalid") throw new InstagramNotConnectedError();
    if (error.kind === "permission") throw new InstagramPermissionError(error.missingScopes);
    if (error.kind === "rate_limited") throw new InstagramRateLimitedError(error.retryAfterMs);
  }
  throw error;
}

function startOfTodayUtc() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function toCompetitorProfile(p: DiscoveredProfile): CompetitorProfile {
  const best = p.posts.reduce<DiscoveredProfile["posts"][number] | null>((b, post) => (!b || post.likes + post.comments > b.likes + b.comments ? post : b), null);
  return {
    handle: p.handle,
    name: p.name,
    avatarUrl: p.avatarUrl,
    location: "",
    verified: false,
    followers: p.followers,
    mediaCount: p.mediaCount,
    // Filled from CompetitorSnapshot history by lib/server/competitor-profiles.ts.
    followerChangePct: 0,
    engagementRate: p.engagementRate,
    postsPerWeek: p.postsPerWeek,
    recentPosts: p.posts.map((post) => ({
      id: post.id,
      tone: toneFor(post.id),
      icon: ICONS[post.id.length % ICONS.length],
      likes: post.likes,
      comments: post.comments,
      notable: post === best,
      mediaUrl: post.mediaUrl,
      permalink: post.permalink,
    })),
    notableNote: "",
    engagementHistory: [],
  };
}

export class MetaInstagramService implements InstagramService {
  /** Used for platform health. */
  constructor(private readonly mock: InstagramService) {}

  private async synced(businessId: string) {
    const conn = await db.instagramConnection.findUnique({ where: { businessId }, select: { profile: true, insights: true } });
    return { profile: (conn?.profile ?? null) as StoredProfile | null, insights: (conn?.insights ?? null) as AccountInsights | null };
  }

  private async posts(businessId: string, sinceDays = 60): Promise<SyncedPost[]> {
    const rows = await db.instagramMedia.findMany({
      where: { businessId, postedAt: { gte: new Date(Date.now() - sinceDays * DAY) } },
      select: { postedAt: true, likeCount: true, commentsCount: true, insights: true },
    });
    return rows.map((r) => ({ postedAt: r.postedAt, likes: r.likeCount, comments: r.commentsCount, insights: (r.insights ?? {}) as Record<string, number> }));
  }

  async getProfile(account: InstagramAccount): Promise<InstagramProfileDto> {
    const { profile } = await this.synced(account.businessId);
    const postsPublishedToday = await db.instagramMedia.count({ where: { businessId: account.businessId, postedAt: { gte: startOfTodayUtc() } } });
    return {
      username: profile?.username || account.username,
      followers: profile?.followers ?? 0,
      following: profile?.follows ?? 0,
      posts: profile?.mediaCount ?? 0,
      bio: profile?.biography ?? "",
      website: profile?.website ?? "",
      postsPublishedToday,
    };
  }

  async getInsights(account: InstagramAccount): Promise<InstagramInsights> {
    const { businessId } = account;
    const [{ profile, insights }, posts, snapshots, business, commentsToday, handledToday, dmsSentToday] = await Promise.all([
      this.synced(businessId),
      this.posts(businessId),
      db.instagramAccountSnapshot.findMany({ where: { businessId }, select: { date: true, followers: true }, orderBy: { date: "desc" }, take: 60 }),
      db.business.findUnique({ where: { id: businessId }, select: { timezone: true } }),
      db.instagramMediaComment.count({ where: { businessId, postedAt: { gte: startOfTodayUtc() }, NOT: { username: account.username } } }),
      db.activityLog.count({ where: { businessId, action: "reply.approved", createdAt: { gte: startOfTodayUtc() } } }),
      db.activityLog.count({ where: { businessId, action: "reply.dm_sent", createdAt: { gte: startOfTodayUtc() } } }),
    ]);
    const timeZone = business?.timezone ?? "Asia/Kuwait";
    const followers = profile?.followers ?? 0;
    const { baselineReach, windows } = windowResults(posts, timeZone);
    return {
      metrics: {
        reach: accountMetric(insights, "reach"),
        engagementRate: engagementMetric(posts, followers),
        followerGrowth: followerGrowthMetric(insights, snapshots),
        profileVisits: accountMetric(insights, "profile_views"),
      },
      followerSeries: followerSeries(snapshots, insights, followers),
      baselineReach,
      windows,
      opportunity: opportunityOf(windows),
      heatmap: heatmapOf(insights, posts, timeZone),
      commentsToday,
      commentsHandledToday: handledToday,
      dmsSentToday,
    };
  }

  async getMedia(account: InstagramAccount, { limit = 12 } = {}): Promise<MediaDto[]> {
    const rows = await db.instagramMedia.findMany({ where: { businessId: account.businessId }, orderBy: { postedAt: "desc" }, take: Math.max(limit, 50) });
    const toDto = (r: (typeof rows)[number]): MediaDto => {
      const insights = (r.insights ?? {}) as Record<string, number>;
      return {
        id: r.igMediaId,
        caption: r.caption,
        mediaUrl: displayUrl(r),
        mediaType: r.mediaType === "VIDEO" ? "video" : "image",
        tone: toneFor(r.igMediaId),
        icon: ICONS[r.igMediaId.length % ICONS.length],
        likes: r.likeCount,
        comments: r.commentsCount,
        reach: insights.reach ?? 0,
        saves: insights.saved ?? 0,
        postedAt: r.postedAt.toISOString(),
      };
    };
    // Best post of the last 30 days first (the dashboard's "top post"), then newest first.
    const recent = rows.filter((r) => Date.now() - r.postedAt.getTime() <= 30 * DAY);
    const top = (recent.length ? recent : rows).reduce<(typeof rows)[number] | null>((b, r) => (!b || r.likeCount + r.commentsCount > b.likeCount + b.commentsCount ? r : b), null);
    const ordered = top ? [top, ...rows.filter((r) => r !== top)] : rows;
    return ordered.slice(0, limit).map(toDto);
  }

  async getComments(account: InstagramAccount): Promise<InstagramComment[]> {
    const rows = await db.instagramMediaComment.findMany({
      where: { businessId: account.businessId, NOT: { username: account.username } },
      orderBy: { postedAt: "desc" },
      take: 200,
    });
    const captions = new Map(
      (await db.instagramMedia.findMany({ where: { businessId: account.businessId, igMediaId: { in: [...new Set(rows.map((r) => r.igMediaId))] } }, select: { igMediaId: true, caption: true } })).map((m) => [m.igMediaId, m.caption]),
    );
    return rows.map((r) => ({ id: r.igCommentId, username: r.username, avatarUrl: null, text: r.text, mediaCaption: captions.get(r.igMediaId) ?? "", postedAt: r.postedAt.toISOString(), likes: r.likeCount }));
  }

  async replyToComment(account: InstagramAccount, commentId: string, text: string) {
    const { token } = requireConnection(account);
    try {
      return await postCommentReply(graphFor(account.businessId), commentId, token, text);
    } catch (error) {
      // The comment no longer exists (deleted by its author or the business, or hidden).
      if (isMetaError(error, "not_found")) throw new InstagramMessagingError("comment_unavailable", error.message);
      translate(error);
    }
  }

  async sendPrivateReply(account: InstagramAccount, commentId: string, text: string) {
    const { token } = requireConnection(account);
    try {
      const { messageId } = await sendPrivateReply(graphFor(account.businessId), token, commentId, text);
      return { id: messageId };
    } catch (error) {
      if (error instanceof MetaMessagingError) throw new InstagramMessagingError(error.reason, error.detail);
      translate(error);
    }
  }

  async replyToMessage(account: InstagramAccount, recipientId: string, text: string) {
    const { token } = requireConnection(account);
    try {
      const { messageId } = await sendTextMessage(graphFor(account.businessId), token, recipientId, text);
      return { id: messageId };
    } catch (error) {
      if (error instanceof MetaMessagingError) throw new InstagramMessagingError(error.reason, error.detail);
      translate(error);
    }
  }

  async getMessagingProfile(account: InstagramAccount, recipientId: string) {
    if (!account.connected || !account.accessToken) return null;
    try {
      const profile = await fetchMessagingProfile(graphFor(account.businessId), account.accessToken, recipientId);
      return profile && { username: profile.username, avatarUrl: profile.avatarUrl };
    } catch {
      return null; // token/rate-limit problems are already logged and flagged by graphFor
    }
  }

  async publishPost(account: InstagramAccount, post: { caption: string; mediaUrl: string | null }) {
    const { igUserId, token } = requireConnection(account);
    // Meta downloads the image itself, so it must be public HTTPS (Vercel Blob, not local uploads).
    if (!isPublicHttpsUrl(post.mediaUrl)) throw new InstagramPublishError("image_not_public");
    try {
      const { mediaId } = await publishImage(graphFor(account.businessId), igUserId, token, { imageUrl: post.mediaUrl, caption: post.caption });
      return { mediaId };
    } catch (error) {
      if (error instanceof MetaPublishError) throw new InstagramPublishError(error.reason, error.detail);
      translate(error);
    }
  }

  async getCompetitorProfile(account: InstagramAccount, handle: string): Promise<CompetitorProfile | null> {
    const lookup = await this.lookupBusinessAccount(account, handle);
    return lookup.status === "ready" ? lookup.profile : null;
  }

  async lookupBusinessAccount(account: InstagramAccount, handle: string): Promise<BusinessAccountLookup> {
    const { igUserId, token } = requireConnection(account);
    const own = { username: account.username, igUserId };
    if (own.username && handle.toLowerCase() === own.username.toLowerCase()) return { status: "own_account", profile: null };
    let outcome;
    try {
      outcome = { result: await businessDiscovery(graphFor(account.businessId), igUserId, token, handle) };
    } catch (error) {
      if (!isMetaError(error)) throw error;
      outcome = { error };
    }
    try {
      const mapped = mapDiscoveryOutcome(handle, outcome, own);
      return { status: mapped.status, profile: mapped.profile && toCompetitorProfile(mapped.profile) };
    } catch (error) {
      translate(error);
    }
  }

  async getTrends(): Promise<InstagramTrends> {
    // The Graph API has no trending audio or hashtag ranking.
    return { audio: [], tags: [] };
  }

  async connectAccount(): Promise<ConnectedAccount> {
    throw new Error("Meta connections are made through Facebook Login (/api/integrations/instagram/start).");
  }

  async getApiHealth(): Promise<ApiHealth> {
    return this.mock.getApiHealth();
  }

  async getRateLimitUsage(account: InstagramAccount): Promise<RateLimitUsage> {
    const state = usageFor(account.businessId);
    const used = state ? Math.round(Math.max(state.usage.appPct, state.usage.businessPct)) : 0;
    const wait = coolingDown(account.businessId);
    return { used, limit: 100, resetsAt: new Date(Date.now() + (wait || 60 * 60 * 1000)).toISOString() };
  }
}
