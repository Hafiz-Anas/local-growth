import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import type { PresignedUpload, SaveInput, StorageService, StoredFile } from "./storage-core";

/**
 * DigitalOcean Spaces (STORAGE_PROVIDER="spaces"), through the S3 API. The bucket is private: the app keeps
 * a stable URL of its own for every file, /api/files/<key>, and that route checks who's asking before it
 * redirects to a short-lived signed link (signedUrl). Instagram gets a signed link too when it fetches a
 * photo to publish. Gallery photos go straight from the browser with a presigned POST that only accepts
 * one content type up to a size (presignUpload); the app checks the bytes afterwards as with every provider.
 *
 * A business's files carry its id in the key — "b/<businessId>/<prefix>/<uuid>.<ext>" — so the file route
 * can refuse other businesses; files saved without one (avatars) are "<prefix>/<uuid>.<ext>".
 * Pure: the S3 client and the presigners are injected (stubbed in tests/storage/spaces.test.ts).
 */

export const FILE_ROUTE = "/api/files/";

/** "<prefix>/<uuid>.<ext>", optionally under "b/<businessId>/". */
export const SPACES_KEY_PATTERN = /^(?:b\/[a-z0-9]{8,40}\/)?[a-z0-9-]+\/[a-f0-9-]{36}\.[a-z0-9]{2,5}$/;
const BUSINESS_ID = /^[a-z0-9]{8,40}$/;

/** The business a key belongs to, or null for a file that isn't a business's (avatars) or an older key. */
export function businessOfKey(key: string): string | null {
  const m = /^b\/([a-z0-9]{8,40})\//.exec(key);
  return m ? m[1] : null;
}

export function newSpacesKey(prefix: string, extension: string, businessId?: string): string {
  const scope = businessId && BUSINESS_ID.test(businessId) ? `b/${businessId}/` : "";
  const key = `${scope}${prefix}/${randomUUID()}.${extension}`;
  if (!SPACES_KEY_PATTERN.test(key)) throw new Error("Invalid storage key.");
  return key;
}

/** The subset of the S3 client used here (`S3Client.send`). */
export interface S3Like {
  send(command: PutObjectCommand | GetObjectCommand | DeleteObjectCommand): Promise<unknown>;
}

export interface SpacesOptions {
  client: S3Like;
  bucket: string;
  /** getSignedUrl from @aws-sdk/s3-request-presigner, bound to the client. */
  presignGet: (command: GetObjectCommand, expiresIn: number) => Promise<string>;
  /** createPresignedPost from @aws-sdk/s3-presigned-post, bound to the client. */
  presignPost: (input: {
    Bucket: string;
    Key: string;
    Conditions: unknown[];
    Fields: Record<string, string>;
    Expires: number;
  }) => Promise<{ url: string; fields: Record<string, string> }>;
}

/** Keys are random and never reused, so a stored file never changes. */
const IMMUTABLE = "private, max-age=31536000, immutable";

export class SpacesStorageService implements StorageService {
  constructor(private readonly options: SpacesOptions) {}

  private fileUrl(key: string) {
    return `${FILE_ROUTE}${key}`;
  }

  private check(key: string) {
    if (!SPACES_KEY_PATTERN.test(key)) throw new Error("Invalid storage key.");
  }

  async save({ data, contentType, prefix, extension, businessId }: SaveInput): Promise<StoredFile> {
    const key = newSpacesKey(prefix, extension, businessId);
    await this.options.client.send(new PutObjectCommand({ Bucket: this.options.bucket, Key: key, Body: data, ContentType: contentType, CacheControl: IMMUTABLE }));
    return { key, url: this.fileUrl(key) };
  }

  async delete(key: string) {
    this.check(key);
    await this.options.client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }));
  }

  async read(key: string): Promise<Buffer | null> {
    if (!SPACES_KEY_PATTERN.test(key)) return null;
    try {
      const out = (await this.options.client.send(new GetObjectCommand({ Bucket: this.options.bucket, Key: key }))) as { Body?: { transformToByteArray(): Promise<Uint8Array> } };
      return out.Body ? Buffer.from(await out.Body.transformToByteArray()) : null;
    } catch (error) {
      const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (e.name === "NoSuchKey" || e.name === "NotFound" || e.$metadata?.httpStatusCode === 404) return null;
      throw error;
    }
  }

  keyFromUrl(url: string): string | null {
    let path = url;
    if (/^https?:\/\//.test(url)) {
      try {
        path = new URL(url).pathname;
      } catch {
        return null;
      }
    }
    if (!path.startsWith(FILE_ROUTE)) return null;
    const key = path.slice(FILE_ROUTE.length);
    return SPACES_KEY_PATTERN.test(key) ? key : null;
  }

  async signedUrl(key: string, ttlSeconds: number): Promise<string> {
    this.check(key);
    return this.options.presignGet(new GetObjectCommand({ Bucket: this.options.bucket, Key: key }), ttlSeconds);
  }

  async presignUpload(input: { prefix: string; extension: string; contentType: string; maxBytes: number; businessId?: string; ttlSeconds: number }): Promise<PresignedUpload> {
    const key = newSpacesKey(input.prefix, input.extension, input.businessId);
    const upload = await this.options.presignPost({
      Bucket: this.options.bucket,
      Key: key,
      Fields: { "Content-Type": input.contentType, "Cache-Control": IMMUTABLE },
      Conditions: [
        ["content-length-range", 1, input.maxBytes],
        ["eq", "$Content-Type", input.contentType],
        ["eq", "$Cache-Control", IMMUTABLE],
      ],
      Expires: input.ttlSeconds,
    });
    return { key, url: this.fileUrl(key), upload };
  }
}
