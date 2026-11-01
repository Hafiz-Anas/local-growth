import { isMetaError } from "./errors";
import type { GraphClient } from "./graph";

/**
 * Publishing through the Graph API ("Instagram API with Facebook Login"), one step per function so the
 * publishing job (lib/server/publishing.ts) can save Instagram's ids between steps and pick up where it
 * left off on the next cron run. Pure (the client is injected) so tests run against recorded responses.
 *
 *   single photo:  POST /{ig-user}/media { image_url, caption }                 → container id
 *   carousel:      POST /{ig-user}/media { image_url, is_carousel_item: true }   → child id (one per photo)
 *                  POST /{ig-user}/media { media_type: CAROUSEL, children, caption } → container id
 *   then:          GET  /{container}?fields=status_code,status                  until FINISHED
 *                  POST /{ig-user}/media_publish { creation_id }                → media id
 *
 * Meta's rules (developers.facebook.com/docs/instagram-platform/content-publishing, checked 2026-11-01):
 * JPEG only, ≤ 8 MB, 4:5–1.91:1, 320–1440 px wide; carousels up to 20 items, caption on the carousel only
 * (children take none), all cropped to the first item's shape; a container expires after 24 h; status_code is
 * EXPIRED / ERROR / FINISHED / IN_PROGRESS / PUBLISHED. The daily publishing limit is read at run time
 * (GET /{ig-user}/content_publishing_limit: the docs say 50 in one place and 100 in another).
 *
 * Every POST is sent once and never retried here (GraphClient.post defaults to noRetry). A container that was
 * created but never published can't go live by itself, so creating a new one is always safe; publishing is
 * the only step that could duplicate a post, which is why the job checks the container's status_code before
 * ever sending media_publish again.
 */

/** Meta allows up to 20 items in a carousel (the Instagram app too); fewer than 2 is a single photo. */
export const CAROUSEL_MIN = 2;
export const CAROUSEL_MAX = 20;
export const CAPTION_MAX = 2200;
export const HASHTAGS_MAX = 30;
export const MENTIONS_MAX = 20;

/** Why publishing failed, beyond the generic Graph errors (token, permission, rate limit). */
export type PublishFailureReason =
  /** Meta couldn't download the image (not public, or the host refused it). */
  | "image_unreachable"
  /** Instagram refused the image or caption (format, size, aspect ratio, …). */
  | "media_rejected"
  /** The container didn't finish processing in time. */
  | "processing_timeout"
  /** The account reached Instagram's limit of API-published posts per 24 hours. */
  | "daily_limit"
  /** The publish call failed in a way that may still have published the post. */
  | "uncertain"
  /** No answer from Meta (network error, timeout, 5xx) on a call that is safe to repeat. */
  | "network";

export class MetaPublishError extends Error {
  constructor(
    readonly reason: PublishFailureReason,
    /** Meta's own wording (English), for the integration log. */
    readonly detail = "",
  ) {
    super(`Publishing failed: ${reason}${detail ? ` — ${detail}` : ""}`);
    this.name = "MetaPublishError";
  }
}

/** Graph error subcodes for a container Instagram won't accept. */
const REJECTED_SUBCODES = new Set([2207004, 2207005, 2207009, 2207010, 2207013, 2207026, 2207028]);
/** "The media could not be fetched from this URI" and friends. */
const UNREACHABLE_SUBCODES = new Set([2207003, 2207020, 2207052]);
/** Graph error codes for media problems (aspect ratio, size, format). */
const REJECTED_CODES = new Set([36000, 36001, 36003, 36004]);
/** "Application request limit reached" for content publishing. */
const DAILY_LIMIT_SUBCODE = 2207042;

const SCOPES = ["instagram_content_publish"] as const;

export type ContainerStatusCode = "EXPIRED" | "ERROR" | "FINISHED" | "IN_PROGRESS" | "PUBLISHED";

/** One photo's container: a single-photo post (with its caption) or a carousel child (no caption). */
export async function createImageContainer(
  client: GraphClient,
  igUserId: string,
  token: string,
  item: { imageUrl: string; caption?: string; carouselItem?: boolean },
): Promise<string> {
  try {
    const params = item.carouselItem ? { image_url: item.imageUrl, is_carousel_item: true } : { image_url: item.imageUrl, caption: item.caption ?? "" };
    const { id } = await client.post<{ id: string }>(`${igUserId}/media`, params, { call: "POST /{ig-user}/media", token, scopes: [...SCOPES] });
    return id;
  } catch (error) {
    throw publishSpecific(error, "network") ?? error;
  }
}

/** The carousel container over its children (in order), with the post's caption. */
export async function createCarouselContainer(client: GraphClient, igUserId: string, token: string, post: { childIds: string[]; caption: string }): Promise<string> {
  try {
    const { id } = await client.post<{ id: string }>(
      `${igUserId}/media`,
      { media_type: "CAROUSEL", children: post.childIds.join(","), caption: post.caption },
      { call: "POST /{ig-user}/media (carousel)", token, scopes: [...SCOPES] },
    );
    return id;
  } catch (error) {
    throw publishSpecific(error, "network") ?? error;
  }
}

/** A container's status_code (and Meta's wording when it failed). Safe to repeat. */
export async function getContainerStatus(client: GraphClient, containerId: string, token: string): Promise<{ code: ContainerStatusCode; detail: string }> {
  try {
    const { status_code, status } = await client.get<{ status_code?: ContainerStatusCode; status?: string }>(
      containerId,
      { fields: "status_code,status" },
      { call: "GET /{ig-container}?fields=status_code", token, scopes: [...SCOPES] },
    );
    return { code: status_code ?? "IN_PROGRESS", detail: status ?? "" };
  } catch (error) {
    throw publishSpecific(error, "network") ?? error;
  }
}

/**
 * Publishes a FINISHED container. No answer (network error, timeout, 5xx) is "uncertain": Meta may have
 * published it, so the caller must check the container's status before sending this again.
 */
export async function publishContainer(client: GraphClient, igUserId: string, token: string, containerId: string): Promise<string> {
  try {
    const { id } = await client.post<{ id: string }>(`${igUserId}/media_publish`, { creation_id: containerId }, { call: "POST /{ig-user}/media_publish", token, scopes: [...SCOPES] });
    return id;
  } catch (error) {
    throw publishSpecific(error, "uncertain") ?? error;
  }
}

export interface RecentMedia {
  id: string;
  caption: string;
  timestamp: string;
  permalink: string | null;
}

/** The account's newest posts (to find the one an unclear publish call created). */
export async function fetchRecentMedia(client: GraphClient, igUserId: string, token: string, limit = 10): Promise<RecentMedia[]> {
  const page = await client.get<{ data?: Array<{ id: string; caption?: string; timestamp?: string; permalink?: string }> }>(
    `${igUserId}/media`,
    { fields: "id,caption,timestamp,permalink", limit },
    { call: "GET /{ig-user}/media (recent)", token },
  );
  return (page.data ?? []).map((m) => ({ id: m.id, caption: m.caption ?? "", timestamp: m.timestamp ?? "", permalink: m.permalink ?? null }));
}

/**
 * The post a container became, among the account's newest posts: posted at or after `since` (a minute's
 * slack for clocks) with the same caption (spaces normalised). Null when none matches.
 */
export function matchPublishedMedia(media: RecentMedia[], caption: string, since: Date): RecentMedia | null {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const want = norm(caption);
  const after = since.getTime() - 60_000;
  return media.find((m) => norm(m.caption) === want && Date.parse(m.timestamp) >= after) ?? null;
}

/** A published post's link on Instagram, or null when Meta doesn't give one. */
export async function fetchPermalink(client: GraphClient, mediaId: string, token: string): Promise<string | null> {
  const media = await client.get<{ permalink?: string }>(mediaId, { fields: "permalink" }, { call: "GET /{ig-media}?fields=permalink", token, quiet: true });
  return media.permalink ?? null;
}

/** Posts published through the API in the last 24 hours and the account's limit, or null when Meta doesn't say. */
export async function fetchPublishingLimit(client: GraphClient, igUserId: string, token: string): Promise<{ used: number; total: number } | null> {
  const page = await client.get<{ data?: Array<{ quota_usage?: number; config?: { quota_total?: number } }> }>(
    `${igUserId}/content_publishing_limit`,
    { fields: "quota_usage,config" },
    { call: "GET /{ig-user}/content_publishing_limit", token, scopes: [...SCOPES] },
  );
  const row = page.data?.[0];
  if (typeof row?.quota_usage !== "number" || typeof row.config?.quota_total !== "number") return null;
  return { used: row.quota_usage, total: row.config.quota_total };
}

/**
 * Publish-specific Graph errors → MetaPublishError; null for the generic ones (token, permission, rate
 * limit), which the service maps to its own errors. `noAnswer`: what a transient failure means for this call.
 */
function publishSpecific(error: unknown, noAnswer: "network" | "uncertain"): MetaPublishError | null {
  if (!isMetaError(error) || error.kind === "token_invalid" || error.kind === "permission") return null;
  const subcode = error.subcode ?? -1;
  if (subcode === DAILY_LIMIT_SUBCODE) return new MetaPublishError("daily_limit", error.message);
  if (error.kind === "rate_limited") return null;
  if (UNREACHABLE_SUBCODES.has(subcode)) return new MetaPublishError("image_unreachable", error.message);
  if (REJECTED_SUBCODES.has(subcode) || REJECTED_CODES.has(error.code ?? -1)) return new MetaPublishError("media_rejected", error.message);
  if (error.kind === "transient") return new MetaPublishError(noAnswer, error.message);
  return null;
}

/** Whether Meta can download from this URL: HTTPS on a public host. */
export function isPublicHttpsUrl(url: string | null): url is string {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !["localhost", "127.0.0.1", "::1", "[::1]"].includes(u.hostname) && !u.hostname.endsWith(".local");
  } catch {
    return false;
  }
}

/** Problems we can spot in a caption before calling Instagram (Meta: 2,200 characters, 30 hashtags, 20 @mentions). */
export function captionProblem(caption: string): "caption_too_long" | "too_many_hashtags" | "too_many_mentions" | null {
  if (caption.length > CAPTION_MAX) return "caption_too_long";
  if ((caption.match(/(^|\s)#[^\s#]+/gu) ?? []).length > HASHTAGS_MAX) return "too_many_hashtags";
  if ((caption.match(/(^|[^\w@])@[A-Za-z0-9._]+/g) ?? []).length > MENTIONS_MAX) return "too_many_mentions";
  return null;
}
