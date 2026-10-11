import "server-only";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { del, head, put } from "@vercel/blob";
import { VercelBlobStorageService } from "./blob-storage";
import { CONTENT_TYPES, KEY_PATTERN, newStorageKey, type StorageService, type StoredFile } from "./storage-core";

/**
 * File storage. Routes depend on this interface only; pick the implementation
 * with STORAGE_PROVIDER: "local" writes to UPLOAD_DIR (development, one
 * server), "vercel-blob" writes to a public Vercel Blob store (production on
 * Vercel, see blob-storage.ts and DEPLOY.md).
 */
export { CONTENT_TYPES, type StorageService, type StoredFile };

const LOCAL_URL_PREFIX = "/api/uploads/";

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
    const key = newStorageKey(prefix, extension);
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
    case "vercel-blob": {
      // Connecting a Blob store to the Vercel project adds BLOB_READ_WRITE_TOKEN (or BLOB_STORE_ID for OIDC).
      const token = process.env.BLOB_READ_WRITE_TOKEN;
      if (!token && !process.env.BLOB_STORE_ID) throw new Error('STORAGE_PROVIDER is "vercel-blob" but BLOB_READ_WRITE_TOKEN is not set.');
      instance = new VercelBlobStorageService({ client: { put, del, head }, token });
      break;
    }
    default:
      throw new Error(`Unknown STORAGE_PROVIDER "${provider}".`);
  }
  return instance;
}
