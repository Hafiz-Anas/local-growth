/**
 * Links inside saved AI chat messages (AssistantMessage.payload): the browser sends a message as the chat draws
 * it, so anything it holds is shown again on every device and in admin preview. Image links are kept only when
 * they point at our own storage (local uploads, the app's sample photos and avatars, Vercel Blob) or Instagram's
 * CDN; other links only when they're https or a path on this site. Anything else is dropped before a message is
 * stored and again when it's read. Pure, so it can be unit-tested (tests/ai-chat-links.test.ts).
 */

/** Fields that hold an image the chat shows (a string, or a list of them). */
const IMAGE_KEYS = new Set(["src", "thumb", "thumbs", "refThumb", "avatarUrl", "mediaUrl", "thumbnailUrl", "imageUrl", "url"]);
/** Fields that hold a link the chat opens. */
const LINK_KEYS = new Set(["link", "permalink", "href"]);

/** Our own files on this site: local uploads (StorageService "local") and the bundled sample photos / avatars. */
const OWN_PATHS = /^\/(api\/uploads|photos|avatars|mock-media)\/[\w\-./%~]+$/;
/** Vercel Blob (StorageService "vercel-blob") and Instagram's image CDN. */
const IMAGE_HOSTS = [/\.public\.blob\.vercel-storage\.com$/i, /(^|\.)cdninstagram\.com$/i, /(^|\.)fbcdn\.net$/i];

export function isAllowedImageUrl(value: string): boolean {
  if (OWN_PATHS.test(value)) return !value.includes("..");
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && IMAGE_HOSTS.some((host) => host.test(url.hostname));
  } catch {
    return false;
  }
}

export function isAllowedLink(value: string): boolean {
  if (/^\/(?![/\\])/.test(value)) return true;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** The payload with every image link not from our storage or Instagram's CDN (and every unsafe link) removed. */
export function sanitizeChatPayload<T>(value: T): T {
  return clean(value) as T;
}

function clean(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clean);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (IMAGE_KEYS.has(key) && typeof v === "string") {
      if (isAllowedImageUrl(v)) out[key] = v;
    } else if (IMAGE_KEYS.has(key) && Array.isArray(v)) {
      out[key] = v.filter((x) => typeof x === "string" && isAllowedImageUrl(x));
    } else if (LINK_KEYS.has(key) && typeof v === "string") {
      if (isAllowedLink(v)) out[key] = v;
    } else out[key] = clean(v);
  }
  return out;
}
