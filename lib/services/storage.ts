import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * File storage. Routes depend on this interface only; pick the implementation
 * with STORAGE_PROVIDER ("local" writes to UPLOAD_DIR — add an S3/R2 class and
 * a case below to move uploads to object storage).
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
  getUrl(key: string): string;
  /** The key behind a URL this service produced, or null for any other URL (e.g. seeded /avatars/*.svg). */
  keyFromUrl(url: string): string | null;
}

const KEY_PATTERN = /^[a-z0-9-]+\/[a-f0-9-]{36}\.[a-z0-9]{2,5}$/;
const LOCAL_URL_PREFIX = "/api/uploads/";

export const CONTENT_TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", mp4: "video/mp4" };

function uploadRoot() {
  return path.resolve(process.cwd(), process.env.UPLOAD_DIR ?? "./uploads");
}

/** Resolves a key inside UPLOAD_DIR, rejecting anything that could escape it. */
function localPath(key: string): string {
  if (!KEY_PATTERN.test(key)) throw new Error("Invalid storage key.");
  const root = uploadRoot();
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) throw new Error("Invalid storage key.");
  return full;
}

/** Writes to the local disk (UPLOAD_DIR); files are served by app/api/uploads/[...key]. */
export class LocalStorageService implements StorageService {
  async save({ data, prefix, extension }: { data: Buffer; contentType: string; prefix: string; extension: string }) {
    const key = `${prefix}/${randomUUID()}.${extension}`;
    const full = localPath(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
    return { key, url: this.getUrl(key) };
  }

  async delete(key: string) {
    try {
      await unlink(localPath(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  async read(key: string) {
    return (await readLocalFile(key))?.data ?? null;
  }

  getUrl(key: string) {
    return `${LOCAL_URL_PREFIX}${key}`;
  }

  keyFromUrl(url: string) {
    if (!url.startsWith(LOCAL_URL_PREFIX)) return null;
    const key = url.slice(LOCAL_URL_PREFIX.length);
    return KEY_PATTERN.test(key) ? key : null;
  }
}

/** For the local file route: reads a stored file, or null if missing/invalid. */
export async function readLocalFile(key: string): Promise<{ data: Buffer; contentType: string } | null> {
  if (!KEY_PATTERN.test(key)) return null;
  try {
    const data = await readFile(localPath(key));
    const extension = key.split(".").pop() ?? "";
    return { data, contentType: CONTENT_TYPES[extension] ?? "application/octet-stream" };
  } catch {
    return null;
  }
}

let instance: StorageService | null = null;

export function getStorageService(): StorageService {
  if (instance) return instance;
  const provider = process.env.STORAGE_PROVIDER ?? "local";
  switch (provider) {
    case "local":
      instance = new LocalStorageService();
      break;
    default:
      throw new Error(`Unknown STORAGE_PROVIDER "${provider}".`);
  }
  return instance;
}
