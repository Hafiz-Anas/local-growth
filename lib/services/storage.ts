import "server-only";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { del, head, put } from "@vercel/blob";
import { VercelBlobStorageService } from "./blob-storage";
import { SpacesStorageService } from "./spaces-storage";
import { CONTENT_TYPES, KEY_PATTERN, newStorageKey, type StorageService, type StoredFile } from "./storage-core";

/**
 * File storage. Routes depend on this interface only; pick the implementation
 * with STORAGE_PROVIDER: "local" writes to UPLOAD_DIR (development, one
 * server), "vercel-blob" writes to a public Vercel Blob store (production on
 * Vercel, see blob-storage.ts and DEPLOY.md), "spaces" writes to a private
 * DigitalOcean Spaces bucket (Kubernetes, see spaces-storage.ts and DEPLOY-DIGITALOCEAN.md).
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

/**
 * Spaces from SPACES_ENDPOINT (e.g. https://fra1.digitaloceanspaces.com), SPACES_REGION, SPACES_BUCKET,
 * SPACES_KEY and SPACES_SECRET. Local testing against MinIO only: SPACES_FORCE_PATH_STYLE=true, and
 * SPACES_PUBLIC_ENDPOINT when the browser reaches the bucket at another address than the server does.
 */
function spacesFromEnv(): StorageService {
  const endpoint = process.env.SPACES_ENDPOINT;
  const bucket = process.env.SPACES_BUCKET;
  const accessKeyId = process.env.SPACES_KEY;
  const secretAccessKey = process.env.SPACES_SECRET;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) throw new Error('STORAGE_PROVIDER is "spaces" but SPACES_ENDPOINT, SPACES_BUCKET, SPACES_KEY or SPACES_SECRET is not set.');
  const common = { region: process.env.SPACES_REGION || "us-east-1", credentials: { accessKeyId, secretAccessKey }, forcePathStyle: process.env.SPACES_FORCE_PATH_STYLE === "true" };
  const client = new S3Client({ ...common, endpoint });
  // Links handed to browsers and Instagram are signed for the address they will use.
  const signer = process.env.SPACES_PUBLIC_ENDPOINT ? new S3Client({ ...common, endpoint: process.env.SPACES_PUBLIC_ENDPOINT }) : client;
  return new SpacesStorageService({
    client,
    bucket,
    presignGet: (command, expiresIn) => getSignedUrl(signer, command, { expiresIn }),
    presignPost: (input) => createPresignedPost(signer, input as Parameters<typeof createPresignedPost>[1]),
  });
}

/** How long the app's file route and Instagram links stay valid (SPACES_URL_TTL seconds, default 10 minutes). */
export const signedUrlTtl = () => Math.max(60, Number(process.env.SPACES_URL_TTL) || 600);

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
    case "spaces":
      instance = spacesFromEnv();
      break;
    default:
      throw new Error(`Unknown STORAGE_PROVIDER "${provider}".`);
  }
  return instance;
}
