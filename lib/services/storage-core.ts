import { randomUUID } from "node:crypto";

/**
 * The StorageService contract and storage keys, shared by every implementation.
 * Pure (no `server-only`) so tests can import the implementations built on it.
 */
export interface StoredFile {
  /** Storage key, e.g. "avatars/3f2c….webp". */
  key: string;
  /** The URL to put in avatarUrl etc.: public (local, Vercel Blob) or the app's own file route (Spaces). */
  url: string;
}

export interface SaveInput {
  data: Buffer;
  contentType: string;
  prefix: string;
  extension: string;
  /**
   * The business the file belongs to. Spaces puts it in the key so only that business (and admins) can
   * open the file; local storage and Vercel Blob ignore it.
   */
  businessId?: string;
}

/** A direct browser upload (Spaces): a presigned POST form that only accepts this file. */
export interface PresignedUpload {
  key: string;
  /** The stored file's URL once uploaded (what the app keeps). */
  url: string;
  upload: { url: string; fields: Record<string, string> };
}

export interface StorageService {
  save(file: SaveInput): Promise<StoredFile>;
  delete(key: string): Promise<void>;
  /** The stored bytes, or null when missing (used server-side, e.g. colour extraction). */
  read(key: string): Promise<Buffer | null>;
  /** The key behind a URL this service produced, or null for any other URL (e.g. seeded /avatars/*.svg). */
  keyFromUrl(url: string): string | null;
  /**
   * Private storage only (Spaces): a link anyone can download for `ttlSeconds` — the app's file route
   * redirects to one, and Instagram gets one to fetch a photo when publishing. Absent on public storage.
   */
  signedUrl?(key: string, ttlSeconds: number): Promise<string>;
  /** Direct browser uploads to private storage (Spaces): a form limited to one content type and size. */
  presignUpload?(input: { prefix: string; extension: string; contentType: string; maxBytes: number; businessId?: string; ttlSeconds: number }): Promise<PresignedUpload>;
}

/** "<prefix>/<uuid>.<extension>" */
export const KEY_PATTERN = /^[a-z0-9-]+\/[a-f0-9-]{36}\.[a-z0-9]{2,5}$/;

export const CONTENT_TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", mp4: "video/mp4" };

export function newStorageKey(prefix: string, extension: string): string {
  const key = `${prefix}/${randomUUID()}.${extension}`;
  if (!KEY_PATTERN.test(key)) throw new Error("Invalid storage key.");
  return key;
}
