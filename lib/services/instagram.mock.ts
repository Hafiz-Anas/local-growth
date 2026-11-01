import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { MOCK_SYSTEM_STATUS } from "@/mock-data/admin";
import { CLIENT_DATA, type ClientDataPack } from "@/mock-data/client-data";
import { MOCK_CLIENTS } from "@/mock-data/clients";
import { POST_ICONS, POST_TONES, generatedMedia, hash, mockCompetitorPostDetails, mockMediaUrl, mockShares } from "@/mock-data/posts";
import type { CompetitorPost, InstagramProfileDto, MediaDto } from "@/types";
import { displayNameFromHandle } from "@/lib/display-names";
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
  type PostMetrics,
  type RateLimitUsage,
} from "./instagram";

/**
 * MOCK Instagram: serves the per-business mock packs (by business id) and
 * pretends to post. Businesses created later get an empty, freshly-connected
 * looking account. Write calls still require a connection, like the real API.
 */

/**
 * Mock publishing: containers live in memory (on globalThis, so every route bundle of `next dev` shares
 * them) and publish at once. Test markers in the caption, honoured by the mock only (e2e, tests/e2e/publishing*):
 *   #e2e_publish_unclear   media_publish posts it but answers "uncertain" (the job must check, not post twice)
 *   #e2e_processing        the container stays IN_PROGRESS for its first two status checks
 *   #e2e_container_error   the container ends in ERROR (Instagram rejected the image)
 *   #e2e_rate_limited      the first container call for this caption is rate limited
 *   #e2e_no_permission     every call fails with the publishing permission missing
 * A second media_publish on a published container is refused, like a duplicate would be.
 */
interface MockContainer {
  businessId: string;
  caption: string;
  carouselItem: boolean;
  checks: number;
  mediaId: string | null;
  publishedAt: number | null;
  createdAt: number;
}
const mockPublishing = ((globalThis as { __lgeMockPublishing?: { containers: Map<string, MockContainer>; rateLimited: Set<string> } }).__lgeMockPublishing ??= {
  containers: new Map(),
  rateLimited: new Set(),
});

function mockPublishGuard(caption: string) {
  if (caption.includes("#e2e_no_permission")) throw new InstagramPermissionError(["instagram_content_publish"]);
}

function mockContainer(account: InstagramAccount, containerId: string): MockContainer | null {
  const c = mockPublishing.containers.get(containerId);
  return c && c.businessId === account.businessId ? c : null;
}

/** The moment the mock data was written for; timestamps are shifted to "now". */
const MOCK_NOW = Date.parse("2026-10-06T12:00:00+03:00");
const shift = (iso: string) => new Date(Date.parse(iso) + (Date.now() - MOCK_NOW)).toISOString();

function packFor(account: InstagramAccount): ClientDataPack | undefined {
  return CLIENT_DATA[account.businessId];
}


function requireConnection(account: InstagramAccount) {
  if (!account.connected) throw new InstagramNotConnectedError();
}

/** Pads a profile's posts to six with stable made-up ones (older, quieter posts). */
function morePosts(handle: string, posts: CompetitorPost[], baseLikes: number): CompetitorPost[] {
  const h = hash(handle);
  const extra = Array.from({ length: Math.max(0, 6 - posts.length) }, (_, i) => ({
    id: `${handle}_older_${i}`,
    tone: POST_TONES[(h + i * 3) % POST_TONES.length],
    icon: POST_ICONS[(h + i * 5) % POST_ICONS.length],
    likes: Math.round(baseLikes * (0.35 + ((h >>> (i + 1)) % 40) / 100)),
    comments: 4 + ((h >>> (i + 2)) % 60),
    notable: false,
  }));
  return [...posts, ...extra];
}

/** Adds caption, posting time and format (the analysis needs them) to a mock competitor's posts. */
function withDetails(handle: string, posts: CompetitorPost[], postsPerWeek: number): CompetitorPost[] {
  return posts.map((p, i) => ({ ...mockCompetitorPostDetails(handle, i, postsPerWeek), ...p }));
}

/**
 * Predictable competitor lookups for testing onboarding (prefix of the handle):
 *   private_…  → private        personal_… → not a business account
 *   missing_…  → not found      your own handle → own account
 * Everything else (including the seeded competitors) is a ready business account.
 */
export const MOCK_LOOKUP_PREFIXES = { private: "private_", not_business: "personal_", not_found: "missing_" } as const;

/** Twelve weekly engagement-rate points ending this week, wandering around `rate`. */
function engagementHistory(handle: string, rate: number): Array<{ date: string; rate: number }> {
  const h = hash(handle);
  const week = 7 * 24 * 60 * 60 * 1000;
  return Array.from({ length: 12 }, (_, i) => {
    const wobble = (((h >>> (i % 16)) % 21) - 10) / 10; // −1.0 … +1.0 (unsigned shift keeps it in range)
    const drift = (i - 11) * 0.04;
    return {
      date: new Date(Date.now() - (11 - i) * week).toISOString().slice(0, 10),
      rate: Math.max(0.2, Math.round((rate + wobble * 0.6 + drift) * 10) / 10),
    };
  });
}

export class MockInstagramService implements InstagramService {
  async getProfile(account: InstagramAccount): Promise<InstagramProfileDto> {
    const mock = MOCK_CLIENTS.find((c) => c.id === account.businessId);
    if (!mock) return { username: account.username, name: displayNameFromHandle(account.username), followers: 0, following: 0, posts: 0, bio: "", website: "", postsPublishedToday: 0 };
    const { followers, following, posts, bio, website, postsPublishedToday } = mock;
    return { username: account.username, name: mock.businessName, followers, following, posts, bio, website, postsPublishedToday };
  }

  async getInsights(account: InstagramAccount): Promise<InstagramInsights> {
    const pack = packFor(account);
    if (!pack) {
      const zero = { value: 0, changePct: 0 };
      return {
        metrics: { reach: zero, engagementRate: zero, followerGrowth: zero, profileVisits: zero },
        followerSeries: [],
        baselineReach: 0,
        windows: [],
        opportunity: null,
        heatmap: Array.from({ length: 7 }, () => Array<number>(24).fill(0)),
        commentsToday: 0,
        commentsHandledToday: 0,
        dmsSentToday: 0,
      };
    }
    const { dashboard, experiment, engagement } = pack;
    return {
      metrics: dashboard.metrics,
      followerSeries: dashboard.followerSeries.map((p) => ({ ...p, date: shift(`${p.date}T12:00:00+03:00`).slice(0, 10) })),
      baselineReach: experiment.baselineReach,
      windows: experiment.windows,
      opportunity: experiment.opportunity,
      heatmap: experiment.heatmap,
      commentsToday: engagement.stats.commentsToday,
      commentsHandledToday: dashboard.quickTiles.commentsHandledToday,
      dmsSentToday: engagement.stats.dmsSent,
    };
  }

  async getMediaImageUrl(account: InstagramAccount, mediaId: string): Promise<string | null> {
    return (await this.getMedia(account, { limit: 50 })).find((m) => m.id === mediaId)?.mediaUrl ?? null;
  }

  async getMedia(account: InstagramAccount, { limit = 12 } = {}): Promise<MediaDto[]> {
    const top = packFor(account)?.dashboard.topPost;
    // Accounts without a mock pack only have posts once connected.
    if (!top && !account.connected) return [];
    const seed = account.username || account.businessId;
    const first: MediaDto[] = top ? [{ ...top, mediaUrl: mockMediaUrl(top.tone), mediaType: "image", format: "photo", shares: mockShares(top.reach, "photo", 1.8), views: null, postedAt: shift(top.postedAt) }] : [];
    return [...first, ...generatedMedia(seed, 12)].slice(0, limit);
  }

  /** The mock post's numbers (they don't change over time); null for an unknown id. */
  async getPostMetrics(account: InstagramAccount, mediaId: string): Promise<PostMetrics | null> {
    requireConnection(account);
    const m = (await this.getMedia(account, { limit: 50 })).find((x) => x.id === mediaId);
    if (!m) return null;
    return { likes: m.likes, comments: m.comments, reach: m.reach > 0 ? m.reach : null, saves: m.reach > 0 ? m.saves : null, shares: m.shares ?? null, views: m.views ?? null };
  }

  async getComments(account: InstagramAccount): Promise<InstagramComment[]> {
    // Ids match the seeded ReplyDraft.commentId values.
    return (packFor(account)?.engagement.replyQueue ?? []).map((c) => ({
      id: `ig_comment_${account.businessId}_${c.id}`,
      username: c.author,
      avatarUrl: c.authorAvatarUrl,
      text: c.text,
      mediaCaption: c.postCaption,
      postedAt: shift(c.postedAt),
      likes: c.likes,
    }));
  }

  async replyToComment(account: InstagramAccount, commentId: string, text: string) {
    requireConnection(account);
    // For trying the "comment was deleted" path locally: comment ids containing "deleted".
    if (commentId.includes("deleted")) throw new InstagramMessagingError("comment_unavailable", "Mock: the comment was deleted.");
    console.info(`[instagram:mock] @${account.username} replied to comment ${commentId}: ${text.slice(0, 80)}`);
    return { id: `ig_reply_${randomUUID()}` };
  }

  async sendPrivateReply(account: InstagramAccount, commentId: string, text: string) {
    requireConnection(account);
    console.info(`[instagram:mock] @${account.username} → private reply to comment ${commentId}: ${text.slice(0, 80)}`);
    return { id: `ig_dm_${randomUUID()}` };
  }

  async replyToMessage(account: InstagramAccount, recipientId: string, text: string) {
    requireConnection(account);
    console.info(`[instagram:mock] @${account.username} → DM reply to ${recipientId}: ${text.slice(0, 80)}`);
    return { id: `ig_dm_${randomUUID()}` };
  }

  async getMessagingProfile() {
    // Simulated DMs (npm run simulate-dm) carry no profile; the webhook falls back to a generic name.
    return null;
  }

  async createPostContainer(account: InstagramAccount, item: { imageUrl: string; caption?: string; carouselItem?: boolean }) {
    requireConnection(account);
    const caption = item.caption ?? "";
    mockPublishGuard(caption);
    if (caption.includes("#e2e_rate_limited") && !mockPublishing.rateLimited.has(caption)) {
      mockPublishing.rateLimited.add(caption);
      throw new InstagramRateLimitedError(null);
    }
    const id = `mock_container_${randomUUID()}`;
    mockPublishing.containers.set(id, { businessId: account.businessId, caption, carouselItem: !!item.carouselItem, checks: 0, mediaId: null, publishedAt: null, createdAt: Date.now() });
    return id;
  }

  async createCarouselContainer(account: InstagramAccount, post: { childIds: string[]; caption: string }) {
    requireConnection(account);
    mockPublishGuard(post.caption);
    if (post.childIds.some((id) => !mockContainer(account, id)?.carouselItem)) throw new InstagramPublishError("media_rejected", "Unknown carousel item.");
    return this.createPostContainer(account, { imageUrl: "", caption: post.caption });
  }

  async getContainerStatus(account: InstagramAccount, containerId: string) {
    requireConnection(account);
    const c = mockContainer(account, containerId);
    // Unknown here (the dev server restarted): treat it as expired, which only ever leads to a new container.
    if (!c) return { code: "EXPIRED" as const, detail: "Unknown container." };
    mockPublishGuard(c.caption);
    c.checks += 1;
    if (c.mediaId) return { code: "PUBLISHED" as const, detail: "" };
    if (c.caption.includes("#e2e_container_error")) return { code: "ERROR" as const, detail: "Error: The aspect ratio is not supported." };
    if (c.caption.includes("#e2e_processing") && c.checks <= 2) return { code: "IN_PROGRESS" as const, detail: "" };
    return { code: "FINISHED" as const, detail: "" };
  }

  async publishContainer(account: InstagramAccount, containerId: string) {
    requireConnection(account);
    const c = mockContainer(account, containerId);
    if (!c) throw new InstagramPublishError("media_rejected", "Unknown container.");
    mockPublishGuard(c.caption);
    if (c.mediaId) throw new InstagramPublishError("media_rejected", "This container was already published.");
    c.mediaId = `ig_media_${randomUUID()}`;
    c.publishedAt = Date.now();
    console.info(`[instagram:mock] @${account.username} published ${c.mediaId}: ${c.caption.slice(0, 80)}`);
    if (c.caption.includes("#e2e_publish_unclear")) throw new InstagramPublishError("uncertain", "Mock: no answer from media_publish.");
    return c.mediaId;
  }

  async findPublishedMedia(account: InstagramAccount, post: { caption: string; since: Date }) {
    requireConnection(account);
    for (const c of mockPublishing.containers.values()) {
      if (c.businessId === account.businessId && c.mediaId && !c.carouselItem && c.caption === post.caption && (c.publishedAt ?? 0) >= post.since.getTime() - 60_000) {
        return { mediaId: c.mediaId, permalink: `https://www.instagram.com/p/${c.mediaId.slice(-11)}/` };
      }
    }
    return null;
  }

  async getPermalink(_account: InstagramAccount, mediaId: string) {
    return `https://www.instagram.com/p/${mediaId.slice(-11)}/`;
  }

  async getPublishingLimit(account: InstagramAccount) {
    requireConnection(account);
    const since = Date.now() - 24 * 60 * 60 * 1000;
    let used = 0;
    for (const c of mockPublishing.containers.values()) if (c.businessId === account.businessId && (c.publishedAt ?? 0) > since && !c.carouselItem) used += 1;
    return { used, total: 50 };
  }

  async getCompetitorProfile(_account: InstagramAccount, handle: string): Promise<CompetitorProfile | null> {
    for (const pack of Object.values(CLIENT_DATA)) {
      const known = pack.competitors.competitors.find((c) => c.handle === handle);
      if (known) {
        const { name, avatarUrl, location, verified, followers, followerChangePct, engagementRate, postsPerWeek, recentPosts, notableNote } = known;
        const baseLikes = Math.max(...recentPosts.map((p) => p.likes));
        return {
          handle,
          name,
          avatarUrl,
          location,
          verified,
          followers,
          followerChangePct,
          engagementRate,
          postsPerWeek,
          recentPosts: withDetails(handle, morePosts(handle, recentPosts, baseLikes), postsPerWeek),
          notableNote,
          engagementHistory: engagementHistory(handle, engagementRate),
        };
      }
    }
    // Any other well-formed handle "exists" with stable made-up numbers.
    const h = hash(handle);
    const tones = ["roast", "sand", "latte", "rose", "pistachio", "date"] as const;
    const icons = ["coffee", "gift", "cake", "bag", "sparkles", "cup"] as const;
    const engagementRate = Math.round((1.5 + (h % 70) / 10) * 10) / 10;
    const recentPosts = [0, 1, 2].map((i) => ({
      id: `${handle}_${i}`,
      tone: tones[(h + i) % tones.length],
      icon: icons[(h + i * 2) % icons.length],
      likes: 200 + ((h >>> i) % 1800),
      comments: 5 + ((h >>> (i + 3)) % 90),
      notable: i === 0,
    }));
    return {
      handle,
      name: handle.replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      avatarUrl: null,
      location: "Kuwait",
      verified: false,
      followers: 1500 + (h % 48000),
      followerChangePct: Math.round(((h % 90) / 10 - 2) * 10) / 10,
      engagementRate,
      postsPerWeek: 2 + (h % 7),
      recentPosts: withDetails(handle, morePosts(handle, recentPosts, Math.max(...recentPosts.map((p) => p.likes))), 2 + (h % 7)),
      notableNote: "Recently added — insights appear after the first full week of tracking.",
      engagementHistory: engagementHistory(handle, engagementRate),
    };
  }

  async lookupBusinessAccount(account: InstagramAccount, handle: string): Promise<BusinessAccountLookup> {
    if (account.username && handle === account.username) return { status: "own_account", profile: null };
    if (handle.startsWith(MOCK_LOOKUP_PREFIXES.private)) return { status: "private", profile: null };
    if (handle.startsWith(MOCK_LOOKUP_PREFIXES.not_business)) return { status: "not_business", profile: null };
    if (handle.startsWith(MOCK_LOOKUP_PREFIXES.not_found)) return { status: "not_found", profile: null };
    const profile = await this.getCompetitorProfile(account, handle);
    return profile ? { status: "ready", profile } : { status: "not_found", profile: null };
  }

  async connectAccount({ businessId, handle }: { businessId: string; handle: string }): Promise<ConnectedAccount> {
    // MOCK OAuth: approve immediately with a random long-lived token (60 days).
    const index = MOCK_CLIENTS.findIndex((c) => c.id === businessId);
    return {
      igUserId: index >= 0 ? `1784140000000${index + 1}` : `17841${(hash(businessId) % 1e10).toString().padStart(10, "0")}`,
      username: handle,
      accessToken: `mock-ig-token-${randomBytes(16).toString("hex")}`,
      expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
    };
  }

  async getApiHealth(): Promise<ApiHealth> {
    const { instagramApi, webhooks } = MOCK_SYSTEM_STATUS;
    return {
      instagramApi: { ...instagramApi, checkedAt: shift(instagramApi.checkedAt) },
      webhooks: { ...webhooks, lastEventAt: shift(webhooks.lastEventAt) },
    };
  }

  async getRateLimitUsage(account: InstagramAccount): Promise<RateLimitUsage> {
    const known = MOCK_SYSTEM_STATUS.rateLimits.find((r) => r.clientId === account.businessId);
    const nextHour = new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000).toISOString();
    return { used: account.connected ? (known?.used ?? 0) : 0, limit: known?.limit ?? 200, resetsAt: nextHour };
  }

  async getTrends(account: InstagramAccount): Promise<InstagramTrends> {
    const pack = packFor(account);
    return { audio: pack?.competitors.trendingAudio ?? [], tags: pack?.competitors.trendingTags ?? [] };
  }
}
