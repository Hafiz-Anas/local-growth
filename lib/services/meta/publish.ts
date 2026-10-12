import { isMetaError } from "./errors";
import type { GraphClient } from "./graph";

/**
 * Single-image publishing through the Graph API ("Instagram API with Facebook
 * Login"). Pure (the client and clock are injected) so tests run it against
 * recorded responses.
 *
 *   1. POST /{ig-user}/media          { image_url, caption } → container id
 *   2. GET  /{container}?fields=status_code,status            until FINISHED
 *   3. POST /{ig-user}/media_publish  { creation_id }        → media id
 *
 * Meta downloads `image_url` itself, so it must be a public HTTPS JPEG (see
 * lib/server/publishing.ts). Both POSTs are sent once — never retried — so a
 * post can't go out twice. Carousels, video, reels and stories aren't supported.
 */

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
  | "uncertain";

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
/** "Application request limit reached" for content publishing (100 posts / 24 h). */
const DAILY_LIMIT_SUBCODE = 2207042;

export interface PublishOptions {
  /** How long to wait for the container to finish processing (default 60 s). */
  timeoutMs?: number;
  /** Delay between status checks (default 3 s; the first check waits 1 s). */
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export async function publishImage(
  client: GraphClient,
  igUserId: string,
  token: string,
  post: { imageUrl: string; caption: string },
  options: PublishOptions = {},
): Promise<{ mediaId: string; containerId: string }> {
  let containerId: string;
  try {
    const container = await client.post<{ id: string }>(
      `${igUserId}/media`,
      { image_url: post.imageUrl, caption: post.caption },
      { call: "POST /{ig-user}/media", token, scopes: ["instagram_content_publish"] },
    );
    containerId = container.id;
  } catch (error) {
    throw publishSpecific(error) ?? error;
  }

  await waitForContainer(client, containerId, token, options);

  try {
    const published = await client.post<{ id: string }>(
      `${igUserId}/media_publish`,
      { creation_id: containerId },
      { call: "POST /{ig-user}/media_publish", token, scopes: ["instagram_content_publish"] },
    );
    return { mediaId: published.id, containerId };
  } catch (error) {
    // No answer (network error, timeout, 5xx): Meta may have published it anyway.
    if (isMetaError(error, "transient")) throw new MetaPublishError("uncertain", error.message);
    throw publishSpecific(error) ?? error;
  }
}

type ContainerStatus = { status_code?: "EXPIRED" | "ERROR" | "FINISHED" | "IN_PROGRESS" | "PUBLISHED"; status?: string };

async function waitForContainer(client: GraphClient, containerId: string, token: string, options: PublishOptions) {
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const deadline = now() + (options.timeoutMs ?? 60_000);
  const interval = options.pollIntervalMs ?? 3_000;

  for (let attempt = 0; ; attempt += 1) {
    await sleep(attempt === 0 ? Math.min(1_000, interval) : interval);
    const { status_code, status } = await client.get<ContainerStatus>(
      containerId,
      { fields: "status_code,status" },
      { call: "GET /{ig-container}?fields=status_code", token, scopes: ["instagram_content_publish"] },
    );
    if (status_code === "FINISHED" || status_code === "PUBLISHED") return;
    if (status_code === "ERROR") throw new MetaPublishError("media_rejected", status ?? "");
    if (status_code === "EXPIRED") throw new MetaPublishError("processing_timeout", "Container expired.");
    if (now() >= deadline) throw new MetaPublishError("processing_timeout", status ?? "");
  }
}

/** Publish-specific Graph errors → MetaPublishError; null for the generic ones (token, permission, rate limit, …). */
function publishSpecific(error: unknown): MetaPublishError | null {
  if (!isMetaError(error) || error.kind === "token_invalid" || error.kind === "permission") return null;
  const subcode = error.subcode ?? -1;
  if (subcode === DAILY_LIMIT_SUBCODE) return new MetaPublishError("daily_limit", error.message);
  if (error.kind === "rate_limited") return null;
  if (UNREACHABLE_SUBCODES.has(subcode)) return new MetaPublishError("image_unreachable", error.message);
  if (REJECTED_SUBCODES.has(subcode) || REJECTED_CODES.has(error.code ?? -1)) return new MetaPublishError("media_rejected", error.message);
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
