import { randomUUID } from "node:crypto";

/**
 * The StorageService contract and storage keys, shared by every implementation.
 * Pure (no `server-only`) so tests can import the implementations built on it.
 */
export interface StoredFile {
  /** Storage key, e.g. "avatars/3f2c….webp". */
  key: string;
  /** Public URL to put in avatarUrl etc. */
  url: string;
}

export interface StorageService {
  save(file: { data: Buffer; contentType: string; prefix: string; extension: string }): Promise<StoredFile>;
  delete(key: string): Promise<void>;
  /** The stored bytes, or null when missing (used server-side, e.g. colour extraction). */
  read(key: string): Promise<Buffer | null>;
  /** The key behind a URL this service produced, or null for any other URL (e.g. seeded /avatars/*.svg). */
  keyFromUrl(url: string): string | null;
}

/** "<prefix>/<uuid>.<extension>" */
export const KEY_PATTERN = /^[a-z0-9-]+\/[a-f0-9-]{36}\.[a-z0-9]{2,5}$/;

export const CONTENT_TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", mp4: "video/mp4" };

export function newStorageKey(prefix: string, extension: string): string {
  const key = `${prefix}/${randomUUID()}.${extension}`;
  if (!KEY_PATTERN.test(key)) throw new Error("Invalid storage key.");
  return key;
}
