import { KEY_PATTERN, newStorageKey, type StorageService, type StoredFile } from "./storage-core";

/**
 * Vercel Blob storage (STORAGE_PROVIDER="vercel-blob"). Files go to a public
 * Blob store and are served from its HTTPS CDN URL, so nothing touches the
 * (read-only, per-instance) disk of a serverless function. The key is the blob
 * pathname, so keys and URLs look the same as with the local provider apart
 * from the host. Pure: the Blob SDK calls are injected (stubbed in tests).
 */

/** The subset of `@vercel/blob` used here. */
export interface BlobClient {
  put(
    pathname: string,
    body: Buffer,
    options: { access: "public"; contentType: string; addRandomSuffix: false; cacheControlMaxAge: number; token?: string },
  ): Promise<{ url: string; pathname: string }>;
  del(urlOrPathname: string, options?: { token?: string }): Promise<void>;
  head(urlOrPathname: string, options?: { token?: string }): Promise<{ url: string }>;
}

export interface VercelBlobOptions {
  client: BlobClient;
  /** BLOB_READ_WRITE_TOKEN; omitted, the SDK falls back to its own env lookup (e.g. Vercel OIDC). */
  token?: string;
  fetch?: typeof fetch;
}

/** Public Blob stores serve from https://<store-id>.public.blob.vercel-storage.com/<pathname>. */
const BLOB_HOST = /^[a-z0-9]+\.public\.blob\.vercel-storage\.com$/;
/** Keys are random and never reused, so a stored file never changes. */
const ONE_YEAR = 60 * 60 * 24 * 365;

export class VercelBlobStorageService implements StorageService {
  private readonly client: BlobClient;
  private readonly token: string | undefined;
  private readonly fetch: typeof fetch;

  constructor(options: VercelBlobOptions) {
    this.client = options.client;
    this.token = options.token || undefined;
    this.fetch = options.fetch ?? fetch;
  }

  private auth() {
    return this.token ? { token: this.token } : {};
  }

  async save({ data, contentType, prefix, extension }: { data: Buffer; contentType: string; prefix: string; extension: string }): Promise<StoredFile> {
    const key = newStorageKey(prefix, extension);
    const blob = await this.client.put(key, data, { access: "public", contentType, addRandomSuffix: false, cacheControlMaxAge: ONE_YEAR, ...this.auth() });
    if (!this.keyFromUrl(blob.url)) throw new Error("Vercel Blob returned an unexpected URL. Is the Blob store public?");
    return { key, url: blob.url };
  }

  async delete(key: string) {
    if (!KEY_PATTERN.test(key)) throw new Error("Invalid storage key.");
    await this.client.del(key, this.auth());
  }

  async read(key: string) {
    if (!KEY_PATTERN.test(key)) return null;
    try {
      const { url } = await this.client.head(key, this.auth());
      const response = await this.fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      if (!response.ok) return null;
      return Buffer.from(await response.arrayBuffer());
    } catch {
      return null; // missing blob or network error: callers treat it like a missing file
    }
  }

  keyFromUrl(url: string) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (parsed.protocol !== "https:" || !BLOB_HOST.test(parsed.hostname) || parsed.search || parsed.hash) return null;
    const key = parsed.pathname.slice(1);
    return KEY_PATTERN.test(key) ? key : null;
  }
}
