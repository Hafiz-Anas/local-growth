import { COMMENT_REPLY_MAX } from "../../replies";
import { isMetaError, MetaApiError } from "./errors";
import type { GraphClient } from "./graph";
import {
  ACCOUNT_TOTAL_METRICS,
  POST_METRICS,
  POST_METRICS_MINIMAL,
  businessDiscoveryFields,
  displayUrl,
  mapComment,
  mapDebugToken,
  mapFollowerDaily,
  mapMedia,
  mapOnlineFollowers,
  mapPages,
  mapPostInsights,
  mapProfile,
  mapTotals,
  type AccountInsights,
  type AccountTotalMetric,
  type CommentRecord,
  type DiscoveryResult,
  type GraphComment,
  type GraphDebugToken,
  type GraphIgAccount,
  type GraphInsight,
  type GraphMedia,
  type GraphPage,
  type MediaRecord,
  type PageCandidate,
  type StoredProfile,
  type TokenInfo,
  type UnavailableMetric,
} from "./mappers";

/**
 * The Graph API endpoints we use, one function each. Pure (the GraphClient is
 * passed in), so tests can run them against recorded responses.
 * `call` names never contain ids or tokens.
 */

// ─── Login ────────────────────────────────────────────────────────────────────────

/** Authorization code → short-lived user token (server-side, with the app secret). */
export async function exchangeCode(client: GraphClient, code: string): Promise<{ accessToken: string; expiresIn: number | null }> {
  const { appId, appSecret, redirectUri } = client.config;
  const res = await client.get<{ access_token: string; expires_in?: number }>(
    "oauth/access_token",
    { client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code },
    { call: "oauth.exchange_code", noRetry: true },
  );
  return { accessToken: res.access_token, expiresIn: res.expires_in ?? null };
}

/** Short-lived → long-lived user token (~60 days). */
export async function exchangeLongLived(client: GraphClient, shortToken: string): Promise<{ accessToken: string; expiresIn: number | null }> {
  const { appId, appSecret } = client.config;
  const res = await client.get<{ access_token: string; expires_in?: number }>(
    "oauth/access_token",
    { grant_type: "fb_exchange_token", client_id: appId, client_secret: appSecret, fb_exchange_token: shortToken },
    { call: "oauth.long_lived_token" },
  );
  return { accessToken: res.access_token, expiresIn: res.expires_in ?? null };
}

/** Validates a user token: issued to our app, still valid; returns its scopes and expiry. */
export async function inspectToken(client: GraphClient, token: string): Promise<TokenInfo> {
  const res = await client.get<GraphDebugToken>("debug_token", { input_token: token }, { call: "GET /debug_token", appToken: true });
  return mapDebugToken(res, client.config.appId);
}

const PAGE_FIELDS = "id,name,access_token,instagram_business_account{id,username,name,profile_picture_url,followers_count,media_count}";

/** Pages the user granted, with their Instagram professional accounts. */
export async function listPages(client: GraphClient, userToken: string) {
  const pages = await client.paginate<GraphPage>("me/accounts", { fields: PAGE_FIELDS, limit: 50 }, { call: "GET /me/accounts", token: userToken, scopes: ["pages_show_list"] }, 200);
  return mapPages(pages);
}

export type { PageCandidate };

// ─── Account ──────────────────────────────────────────────────────────────────────

const PROFILE_FIELDS = "username,name,profile_picture_url,followers_count,follows_count,media_count,biography,website";

export async function fetchProfile(client: GraphClient, igUserId: string, token: string): Promise<StoredProfile> {
  const res = await client.get<GraphIgAccount>(igUserId, { fields: PROFILE_FIELDS }, { call: "GET /{ig-user}", token, scopes: ["instagram_basic"] });
  return mapProfile(res);
}

const MEDIA_FIELDS = "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count";

export async function fetchMedia(client: GraphClient, igUserId: string, token: string, max = 50): Promise<MediaRecord[]> {
  const items = await client.paginate<GraphMedia>(`${igUserId}/media`, { fields: MEDIA_FIELDS, limit: Math.min(max, 50) }, { call: "GET /{ig-user}/media", token, scopes: ["instagram_basic"] }, max);
  return items.map(mapMedia);
}

/** A post's current like and comment counts (one call; post monitoring). Throws MetaApiError "not_found" for a deleted post. */
export async function fetchMediaCounts(client: GraphClient, mediaId: string, token: string): Promise<{ likes: number; comments: number }> {
  const res = await client.get<GraphMedia>(mediaId, { fields: "id,like_count,comments_count" }, { call: "GET /{ig-media}", token, scopes: ["instagram_basic"] });
  return { likes: res.like_count ?? 0, comments: res.comments_count ?? 0 };
}

/** A post's current image link (a video's thumbnail); links expire, so read it at the time of use. */
export async function fetchMediaImageUrl(client: GraphClient, mediaId: string, token: string): Promise<string | null> {
  const res = await client.get<GraphMedia>(mediaId, { fields: "id,media_type,media_url,thumbnail_url" }, { call: "GET /{ig-media}", token, scopes: ["instagram_basic"] });
  return displayUrl({ mediaType: res.media_type ?? "IMAGE", mediaUrl: res.media_url ?? null, thumbnailUrl: res.thumbnail_url ?? null });
}

/** Errors that stop a whole sync (anything else just makes a metric unavailable). */
const fatal = (error: unknown) => isMetaError(error, "token_invalid") || isMetaError(error, "rate_limited");
const reasonOf = (error: unknown) => (error instanceof MetaApiError ? `${error.kind}:${error.codeLabel}` : "unknown");

const DAY_S = 24 * 60 * 60;
/** Meta allows at most 30 days between since and until. */
const RANGE_S = 30 * DAY_S - 60;

async function totals(client: GraphClient, igUserId: string, token: string, metrics: readonly AccountTotalMetric[], since: number, until: number, unavailable: UnavailableMetric[]) {
  const call = (list: readonly AccountTotalMetric[]) =>
    client.get<{ data: GraphInsight[] }>(
      `${igUserId}/insights`,
      { metric: list.join(","), period: "day", metric_type: "total_value", since, until },
      { call: "GET /{ig-user}/insights", token, scopes: ["instagram_manage_insights"], quiet: true },
    );
  try {
    const { values, missing } = mapTotals((await call(metrics)).data ?? [], metrics);
    for (const m of missing) unavailable.push({ metric: m, reason: "missing" });
    return values;
  } catch (error) {
    if (fatal(error)) throw error;
    if (isMetaError(error, "permission")) {
      for (const m of metrics) unavailable.push({ metric: m, reason: reasonOf(error) });
      return {};
    }
    // One unsupported metric fails the whole request: ask one by one to find out which.
    const values: Partial<Record<AccountTotalMetric, number>> = {};
    for (const metric of metrics) {
      try {
        const one = mapTotals((await call([metric])).data ?? [], [metric]);
        if (one.values[metric] !== undefined) values[metric] = one.values[metric];
        else unavailable.push({ metric, reason: "missing" });
      } catch (inner) {
        if (fatal(inner)) throw inner;
        unavailable.push({ metric, reason: reasonOf(inner) });
      }
    }
    return values;
  }
}

/**
 * Account insights for the last 30 days (and the 30 before, for change %).
 * Small or new accounts miss some metrics — those are listed in `unavailable`
 * (and logged by the caller) instead of failing the sync.
 */
export async function fetchAccountInsights(client: GraphClient, igUserId: string, token: string, now = Date.now()): Promise<AccountInsights> {
  const until = Math.floor(now / 1000);
  const since = until - RANGE_S;
  const unavailable: UnavailableMetric[] = [];

  const current = await totals(client, igUserId, token, ACCOUNT_TOTAL_METRICS, since, until, unavailable);
  const available = ACCOUNT_TOTAL_METRICS.filter((m) => current[m] !== undefined);
  const previous = available.length ? await totals(client, igUserId, token, available, since - RANGE_S, since, []) : {};

  let followerDaily: AccountInsights["followerDaily"] = null;
  try {
    const res = await client.get<{ data: GraphInsight[] }>(
      `${igUserId}/insights`,
      { metric: "follower_count", period: "day", since, until },
      { call: "GET /{ig-user}/insights", token, scopes: ["instagram_manage_insights"], quiet: true },
    );
    followerDaily = mapFollowerDaily(res.data ?? []);
    if (!followerDaily) unavailable.push({ metric: "follower_count", reason: "missing" });
  } catch (error) {
    if (fatal(error)) throw error;
    unavailable.push({ metric: "follower_count", reason: reasonOf(error) });
  }

  let onlineFollowers: AccountInsights["onlineFollowers"] = null;
  try {
    const res = await client.get<{ data: GraphInsight[] }>(
      `${igUserId}/insights`,
      { metric: "online_followers", period: "lifetime", since, until },
      { call: "GET /{ig-user}/insights", token, scopes: ["instagram_manage_insights"], quiet: true },
    );
    onlineFollowers = mapOnlineFollowers(res.data ?? []);
    if (!onlineFollowers) unavailable.push({ metric: "online_followers", reason: "missing" });
  } catch (error) {
    if (fatal(error)) throw error;
    unavailable.push({ metric: "online_followers", reason: reasonOf(error) });
  }

  return { current, previous, followerDaily, onlineFollowers, unavailable, syncedAt: new Date(now).toISOString() };
}

/** Lifetime insights of one post; null when Meta has none for it (e.g. posted before the account went professional). */
export async function fetchPostInsights(client: GraphClient, mediaId: string, token: string): Promise<{ values: Record<string, number> | null; reason?: string }> {
  for (const metrics of [POST_METRICS, POST_METRICS_MINIMAL]) {
    try {
      const res = await client.get<{ data: GraphInsight[] }>(
        `${mediaId}/insights`,
        { metric: metrics.join(",") },
        { call: "GET /{ig-media}/insights", token, scopes: ["instagram_manage_insights"], quiet: true },
      );
      return { values: mapPostInsights(res.data ?? []) };
    } catch (error) {
      if (fatal(error) || isMetaError(error, "permission")) throw error;
      if (metrics === POST_METRICS_MINIMAL) return { values: null, reason: reasonOf(error) };
    }
  }
  return { values: null };
}

export async function fetchComments(client: GraphClient, mediaId: string, token: string, max = 50): Promise<CommentRecord[]> {
  const items = await client.paginate<GraphComment>(
    `${mediaId}/comments`,
    { fields: "id,text,username,timestamp,like_count", limit: Math.min(max, 50) },
    { call: "GET /{ig-media}/comments", token, scopes: ["instagram_manage_comments"] },
    max,
  );
  return items.map(mapComment);
}

/** Instagram rejects longer replies to comments (lib/replies.ts). */
export const COMMENT_MAX_LENGTH = COMMENT_REPLY_MAX;

export async function postCommentReply(client: GraphClient, commentId: string, token: string, message: string): Promise<{ id: string }> {
  return client.post<{ id: string }>(`${commentId}/replies`, { message }, { call: "POST /{ig-comment}/replies", token, scopes: ["instagram_manage_comments"] });
}

/** Public data of another professional account, through the business's own account. */
export async function businessDiscovery(client: GraphClient, igUserId: string, token: string, handle: string): Promise<DiscoveryResult> {
  return client.get<DiscoveryResult>(igUserId, { fields: businessDiscoveryFields(handle) }, { call: "GET /{ig-user}?fields=business_discovery", token, scopes: ["instagram_basic", "pages_read_engagement"], quiet: true });
}
