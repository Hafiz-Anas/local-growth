import type { CompetitorValidation } from "@/types/onboarding";
import { MetaApiError } from "./errors";

/**
 * Graph API responses → the app's records. Pure; covered by tests/meta against
 * recorded sample responses.
 */

// ─── Raw Graph shapes (only the fields we request) ──────────────────────────────

export interface GraphIgAccount {
  id: string;
  username?: string;
  name?: string;
  profile_picture_url?: string;
  followers_count?: number;
  follows_count?: number;
  media_count?: number;
  biography?: string;
  website?: string;
}

export interface GraphPage {
  id: string;
  name?: string;
  access_token?: string;
  instagram_business_account?: GraphIgAccount;
}

export interface GraphMedia {
  id: string;
  caption?: string;
  media_type?: string;
  media_product_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
}

export interface GraphComment {
  id: string;
  text?: string;
  username?: string;
  timestamp?: string;
  like_count?: number;
}

export interface GraphInsightValue {
  value?: number | Record<string, number>;
  end_time?: string;
}

export interface GraphInsight {
  name: string;
  period?: string;
  values?: GraphInsightValue[];
  total_value?: { value?: number };
}

export interface GraphDebugToken {
  data?: {
    app_id?: string;
    user_id?: string;
    is_valid?: boolean;
    scopes?: string[];
    expires_at?: number;
    data_access_expires_at?: number;
    error?: { code?: number; message?: string; subcode?: number };
  };
}

// ─── Pages ───────────────────────────────────────────────────────────────────────

/** A Facebook Page with an Instagram professional account — one choice in the account picker. */
export interface PageCandidate {
  pageId: string;
  pageName: string;
  /** Secret. Stays server-side (encrypted); never in `PageOption`. */
  pageToken: string;
  igUserId: string;
  username: string;
  name: string | null;
  pictureUrl: string | null;
  followers: number;
  mediaCount: number;
}

/** What the picker shows (no tokens). */
export type PageOption = Omit<PageCandidate, "pageToken">;

export function mapPages(pages: GraphPage[]): { candidates: PageCandidate[]; pagesWithoutInstagram: number } {
  const candidates: PageCandidate[] = [];
  let pagesWithoutInstagram = 0;
  for (const page of pages) {
    const ig = page.instagram_business_account;
    if (!ig?.id || !page.access_token) {
      pagesWithoutInstagram += 1;
      continue;
    }
    candidates.push({
      pageId: page.id,
      pageName: page.name ?? "",
      pageToken: page.access_token,
      igUserId: ig.id,
      username: ig.username ?? "",
      name: ig.name ?? null,
      pictureUrl: ig.profile_picture_url ?? null,
      followers: ig.followers_count ?? 0,
      mediaCount: ig.media_count ?? 0,
    });
  }
  return { candidates, pagesWithoutInstagram };
}

export const toPageOption = (p: PageCandidate): PageOption => ({
  pageId: p.pageId,
  pageName: p.pageName,
  igUserId: p.igUserId,
  username: p.username,
  name: p.name,
  pictureUrl: p.pictureUrl,
  followers: p.followers,
  mediaCount: p.mediaCount,
});

// ─── Tokens ──────────────────────────────────────────────────────────────────────

export interface TokenInfo {
  appId: string;
  userId: string;
  scopes: string[];
  /** Null when the token doesn't expire. */
  expiresAt: Date | null;
  dataAccessExpiresAt: Date | null;
}

const fromUnix = (s: number | undefined) => (s && s > 0 ? new Date(s * 1000) : null);

/**
 * Validates /debug_token: the token must be valid and issued to *our* app (a
 * token from another app pasted into the fragment flow is rejected).
 */
export function mapDebugToken(res: GraphDebugToken, expectedAppId: string): TokenInfo {
  const d = res.data;
  if (!d?.is_valid) {
    throw new MetaApiError({ call: "GET /debug_token", kind: "token_invalid", code: d?.error?.code ?? 190, subcode: d?.error?.subcode ?? null, message: d?.error?.message ?? "The token isn't valid." });
  }
  if (d.app_id !== expectedAppId) {
    throw new MetaApiError({ call: "GET /debug_token", kind: "token_invalid", code: 190, message: "The token was issued to a different app." });
  }
  return { appId: d.app_id, userId: d.user_id ?? "", scopes: d.scopes ?? [], expiresAt: fromUnix(d.expires_at), dataAccessExpiresAt: fromUnix(d.data_access_expires_at) };
}

// ─── Profile & media ─────────────────────────────────────────────────────────────

/** Stored on InstagramConnection.profile. */
export interface StoredProfile {
  username: string;
  name: string | null;
  biography: string;
  website: string;
  pictureUrl: string | null;
  followers: number;
  follows: number;
  mediaCount: number;
}

export function mapProfile(ig: GraphIgAccount): StoredProfile {
  return {
    username: ig.username ?? "",
    name: ig.name ?? null,
    biography: ig.biography ?? "",
    website: ig.website ?? "",
    pictureUrl: ig.profile_picture_url ?? null,
    followers: ig.followers_count ?? 0,
    follows: ig.follows_count ?? 0,
    mediaCount: ig.media_count ?? 0,
  };
}

/** Columns of an InstagramMedia row. */
export interface MediaRecord {
  igMediaId: string;
  caption: string;
  mediaType: string;
  mediaProductType: string | null;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  permalink: string | null;
  postedAt: Date;
  likeCount: number;
  commentsCount: number;
}

export function mapMedia(m: GraphMedia): MediaRecord {
  return {
    igMediaId: m.id,
    caption: m.caption ?? "",
    mediaType: m.media_type ?? "IMAGE",
    mediaProductType: m.media_product_type ?? null,
    // Videos (and reels) have media_url pointing at the video; owners can hide it (copyrighted audio).
    mediaUrl: m.media_url ?? null,
    thumbnailUrl: m.thumbnail_url ?? null,
    permalink: m.permalink ?? null,
    postedAt: m.timestamp ? new Date(m.timestamp) : new Date(0),
    likeCount: m.like_count ?? 0,
    commentsCount: m.comments_count ?? 0,
  };
}

/** Image to show for a post: the photo itself, or a video's thumbnail. */
export function displayUrl(m: Pick<MediaRecord, "mediaType" | "mediaUrl" | "thumbnailUrl">): string | null {
  return m.mediaType === "VIDEO" ? (m.thumbnailUrl ?? null) : (m.mediaUrl ?? m.thumbnailUrl ?? null);
}

export interface CommentRecord {
  igCommentId: string;
  username: string;
  text: string;
  likeCount: number;
  postedAt: Date;
}

export function mapComment(c: GraphComment): CommentRecord {
  return { igCommentId: c.id, username: c.username ?? "", text: c.text ?? "", likeCount: c.like_count ?? 0, postedAt: c.timestamp ? new Date(c.timestamp) : new Date() };
}

// ─── Insights ────────────────────────────────────────────────────────────────────

/** Account metrics requested as total_value over a 30-day range. */
export const ACCOUNT_TOTAL_METRICS = ["reach", "views", "accounts_engaged", "total_interactions", "profile_links_taps", "profile_views"] as const;
export type AccountTotalMetric = (typeof ACCOUNT_TOTAL_METRICS)[number];

/** Per-post metrics. Not every metric exists for every media type; the sync falls back to POST_METRICS_MINIMAL. */
export const POST_METRICS = ["reach", "saved", "shares", "total_interactions", "views"] as const;
export const POST_METRICS_MINIMAL = ["reach", "saved"] as const;

export interface UnavailableMetric {
  metric: string;
  /** Graph error code, or "missing" when the call succeeded without the metric. */
  reason: string;
}

/** Stored on InstagramConnection.insights. Absent metric = not available for this account yet. */
export interface AccountInsights {
  current: Partial<Record<AccountTotalMetric, number>>;
  previous: Partial<Record<AccountTotalMetric, number>>;
  /** New followers per day (follower_count; accounts with 100+ followers only). */
  followerDaily: Array<{ date: string; value: number }> | null;
  /** Average online followers by hour 0–23 and weekday 0 (Sun)–6 (online_followers; 100+ followers). */
  onlineFollowers: number[][] | null;
  unavailable: UnavailableMetric[];
  syncedAt: string;
}

/** total_value insights → { metric: value }. Metrics missing from the response are reported. */
export function mapTotals<M extends string>(data: GraphInsight[], requested: readonly M[]): { values: Partial<Record<M, number>>; missing: M[] } {
  const values: Partial<Record<M, number>> = {};
  for (const item of data) {
    const v = item.total_value?.value ?? (typeof item.values?.[0]?.value === "number" ? (item.values[0].value as number) : undefined);
    if ((requested as readonly string[]).includes(item.name) && typeof v === "number") values[item.name as M] = v;
  }
  return { values, missing: requested.filter((m) => values[m] === undefined) };
}

/** Post insights (lifetime) → { reach: n, saved: n, … }. */
export function mapPostInsights(data: GraphInsight[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of data) {
    const v = item.total_value?.value ?? item.values?.[0]?.value;
    if (typeof v === "number") out[item.name] = v;
  }
  return out;
}

export function mapFollowerDaily(data: GraphInsight[]): Array<{ date: string; value: number }> | null {
  const series = data.find((d) => d.name === "follower_count")?.values;
  if (!series?.length) return null;
  return series.filter((v) => typeof v.value === "number" && v.end_time).map((v) => ({ date: v.end_time!.slice(0, 10), value: v.value as number }));
}

/**
 * online_followers (one value per day, keyed by hour "0"–"23") → 7×24 averages by
 * weekday. Meta reports the hours in the account's time zone as configured on
 * Meta's side; we take them as-is.
 */
export function mapOnlineFollowers(data: GraphInsight[]): number[][] | null {
  const days = data.find((d) => d.name === "online_followers")?.values;
  if (!days?.length) return null;
  const sum = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  const count = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  let any = false;
  for (const day of days) {
    if (!day.end_time || typeof day.value !== "object" || !day.value) continue;
    const weekday = new Date(day.end_time).getUTCDay();
    for (const [hour, n] of Object.entries(day.value)) {
      const h = Number(hour);
      if (h >= 0 && h < 24 && typeof n === "number") {
        sum[weekday][h] += n;
        count[weekday][h] += 1;
        any = true;
      }
    }
  }
  if (!any) return null;
  return sum.map((row, d) => row.map((s, h) => (count[d][h] ? s / count[d][h] : 0)));
}

/** Scales a grid to 0..1 (the heatmap's relative activity). */
export function normalizeGrid(grid: number[][]): number[][] {
  const max = Math.max(0, ...grid.flat());
  return grid.map((row) => row.map((v) => (max ? Math.round((v / max) * 100) / 100 : 0)));
}

/** Percent change, rounded to one decimal; 0 when there's no previous value. */
export function changePct(current: number, previous: number | undefined | null): number {
  if (!previous) return 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

// ─── Competitors (business discovery) ──────────────────────────────────────────

export interface DiscoveryResult {
  business_discovery?: GraphIgAccount & { media?: { data?: GraphMedia[] } };
  id?: string;
}

export interface DiscoveredPost {
  id: string;
  mediaUrl: string | null;
  permalink: string | null;
  likes: number;
  comments: number;
  postedAt: string;
  caption: string;
}

export interface DiscoveredProfile {
  handle: string;
  name: string;
  avatarUrl: string | null;
  followers: number;
  mediaCount: number;
  engagementRate: number;
  postsPerWeek: number;
  posts: DiscoveredPost[];
}

/** Average (likes + comments) per post as a percent of followers, one decimal. */
export function engagementRateOf(posts: Array<{ likes: number; comments: number }>, followers: number): number {
  if (!posts.length || followers <= 0) return 0;
  const avg = posts.reduce((n, p) => n + p.likes + p.comments, 0) / posts.length;
  return Math.round((avg / followers) * 1000) / 10;
}

/** Posts per week over the span of the given timestamps (at least one week). */
export function postsPerWeekOf(timestamps: string[], now = Date.now()): number {
  const times = timestamps.map((t) => Date.parse(t)).filter(Number.isFinite);
  if (!times.length) return 0;
  const spanWeeks = Math.max(1, (now - Math.min(...times)) / (7 * 24 * 3_600_000));
  return Math.round((times.length / spanWeeks) * 10) / 10;
}

export function mapDiscoveredProfile(handle: string, result: DiscoveryResult, now = Date.now()): DiscoveredProfile | null {
  const bd = result.business_discovery;
  if (!bd) return null;
  const posts: DiscoveredPost[] = (bd.media?.data ?? []).map((m) => ({
    id: m.id,
    mediaUrl: m.media_type === "VIDEO" ? (m.thumbnail_url ?? null) : (m.media_url ?? m.thumbnail_url ?? null),
    permalink: m.permalink ?? null,
    likes: m.like_count ?? 0,
    comments: m.comments_count ?? 0,
    postedAt: m.timestamp ?? new Date(now).toISOString(),
    caption: m.caption ?? "",
  }));
  const followers = bd.followers_count ?? 0;
  return {
    handle: bd.username ?? handle,
    name: bd.name ?? bd.username ?? handle,
    avatarUrl: bd.profile_picture_url ?? null,
    followers,
    mediaCount: bd.media_count ?? 0,
    engagementRate: engagementRateOf(posts, followers),
    postsPerWeek: postsPerWeekOf(posts.map((p) => p.postedAt), now),
    posts,
  };
}

/**
 * business_discovery outcome → competitor validation status.
 *
 * What Meta actually tells us (documented in README → "Meta integration"):
 *   success                                  → ready
 *   same account as the business's own       → own_account (checked before calling, and on the returned id)
 *   110 / 2207013 "user … cannot be found"   → not_found. Meta returns this one error for a username that
 *                                              doesn't exist AND for personal accounts (private or public);
 *                                              it can't be told apart, so the UI says "not found, or a personal account".
 *   100 / 33, 24, other 110                  → not_found
 *   private                                  → never reported: business/creator accounts can't be private,
 *                                              and private personal accounts come back as 110/2207013.
 *   not_business                             → never reported separately (see 110/2207013).
 * Any other error (token, permission, rate limit, outage) is NOT a lookup result: it's thrown.
 */
export function mapDiscoveryOutcome(
  handle: string,
  outcome: { result: DiscoveryResult } | { error: MetaApiError },
  own: { username: string; igUserId: string | null },
): { status: CompetitorValidation; profile: DiscoveredProfile | null } {
  if (own.username && handle.toLowerCase() === own.username.toLowerCase()) return { status: "own_account", profile: null };
  if ("error" in outcome) {
    if (outcome.error.kind === "not_found" || (outcome.error.kind === "invalid_request" && outcome.error.code === 100)) return { status: "not_found", profile: null };
    throw outcome.error;
  }
  const profile = mapDiscoveredProfile(handle, outcome.result);
  if (!profile) return { status: "not_found", profile: null };
  if (own.igUserId && outcome.result.business_discovery?.id === own.igUserId) return { status: "own_account", profile: null };
  return { status: "ready", profile };
}

/** Fields for GET /{ig-user}?fields=business_discovery.username(handle){…}. */
export function businessDiscoveryFields(handle: string, mediaLimit = 12): string {
  const safe = handle.replace(/[^A-Za-z0-9._]/g, "");
  return `business_discovery.username(${safe}){id,username,name,profile_picture_url,followers_count,media_count,media.limit(${mediaLimit}){id,caption,media_type,media_url,thumbnail_url,permalink,like_count,comments_count,timestamp}}`;
}
