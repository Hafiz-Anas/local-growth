import "server-only";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import sharp, { type Metadata } from "sharp";
import { db } from "@/lib/db";
import { GALLERY_DRAFT_WHERE } from "@/lib/server/gallery";
import {
  GALLERY_PENDING_TTL_MS,
  GALLERY_REMOVE_GRACE_MS,
  GALLERY_THUMB_EDGE,
  GALLERY_UPLOAD_MAX_BYTES,
  extensionFor,
  titleFromName,
  type GalleryUploadType,
} from "@/lib/gallery/uploads";
import { sniffImage } from "@/lib/uploads/sniff";
import { CONTENT_TYPES, getStorageService } from "@/lib/services/storage";
import { newStorageKey } from "@/lib/services/storage-core";
import type { GalleryPhotoDto, GalleryUploadTicketDto } from "@/types/api";
import { logActivity } from "./activity";
import { ApiError, notFound } from "./http";
import { readUpload } from "./uploads";

/**
 * Gallery uploads (BE1). The browser makes photos smaller first (lib/gallery/upload-client.ts), then:
 *  1. POST /api/gallery/uploads — one PENDING GalleryPhoto per file and a permission to store exactly that
 *     file: with Vercel Blob a client token for one pathname, image types only, up to GALLERY_UPLOAD_MAX_BYTES,
 *     valid 15 minutes; with local storage (development, e2e) our own PUT route.
 *  2. The browser sends the file straight to Blob, so it never passes through our API (Vercel's 4.5 MB
 *     request limit doesn't apply).
 *  3. POST /api/gallery/uploads/:id/complete — the stored bytes are checked again here (real type, size,
 *     readable dimensions), a thumbnail is made, and the photo becomes READY. Anything that fails is deleted.
 * Uploads that never finish, and own photos removed more than a day ago, are deleted by the daily cron.
 */

const UPLOAD_PREFIX = "gallery";
const THUMB_PREFIX = "gallery-thumbs";
const TOKEN_TTL_MS = 15 * 60 * 1000;

type Reason = "type" | "size" | "missing" | "unreadable";

const REASON_TEXT: Record<Reason, string> = {
  type: "Use a JPG, PNG or WebP photo.",
  size: "The photo is too big.",
  missing: "The photo didn't arrive. Please try again.",
  unreadable: "The photo couldn't be read.",
};

const invalid = (reason: Reason) => new ApiError(422, "upload_invalid", REASON_TEXT[reason], [{ path: "reason", message: reason }]);

const storageMode = (): "blob" | "local" => (process.env.STORAGE_PROVIDER === "vercel-blob" ? "blob" : "local");

/** Step 1: one PENDING photo and upload permission per file. */
export async function startUploads(businessId: string, userId: string, files: Array<{ name: string; type: GalleryUploadType; size: number }>): Promise<GalleryUploadTicketDto[]> {
  const mode = storageMode();
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (mode === "blob" && !token) throw new ApiError(503, "storage_unavailable", "Photo uploads aren't set up yet.");

  const tickets: GalleryUploadTicketDto[] = [];
  for (const file of files) {
    // With Blob the file's place is fixed now and the token only allows that one pathname.
    const pathname = mode === "blob" ? newStorageKey(UPLOAD_PREFIX, extensionFor(file.type)) : null;
    const row = await db.galleryPhoto.create({
      data: { businessId, source: "UPLOADED", status: "PENDING", storageKey: pathname, contentType: file.type, title: titleFromName(file.name) || null, uploadedBy: userId },
      select: { id: true },
    });
    const clientToken =
      pathname && token
        ? await generateClientTokenFromReadWriteToken({
            token,
            pathname,
            allowedContentTypes: [file.type],
            maximumSizeInBytes: GALLERY_UPLOAD_MAX_BYTES,
            validUntil: Date.now() + TOKEN_TTL_MS,
            addRandomSuffix: false,
          })
        : null;
    tickets.push({ id: row.id, mode, pathname, token: clientToken, uploadUrl: mode === "local" ? `/api/gallery/uploads/${row.id}` : null });
  }
  return tickets;
}

async function pending(businessId: string, id: string) {
  const row = await db.galleryPhoto.findFirst({ where: { id, businessId, status: "PENDING", source: "UPLOADED" }, select: { id: true, storageKey: true, title: true } });
  if (!row) throw notFound("Upload");
  return row;
}

/** Step 2 with local storage: PUT /api/gallery/uploads/:id (multipart "file"). Answers the file's URL. */
export async function receiveLocalUpload(businessId: string, id: string, request: Request): Promise<{ url: string }> {
  if (storageMode() !== "local") throw notFound("Upload");
  const row = await pending(businessId, id);
  if (row.storageKey) throw new ApiError(409, "conflict", "This photo was already sent.");
  const upload = await readUpload(request, { imageMax: GALLERY_UPLOAD_MAX_BYTES, labels: { image: "10 MB" } });
  const stored = await getStorageService().save({ data: upload.data, contentType: CONTENT_TYPES[upload.extension], prefix: UPLOAD_PREFIX, extension: upload.extension });
  await db.galleryPhoto.update({ where: { id: row.id }, data: { storageKey: stored.key } });
  return { url: stored.url };
}

/** Deletes an upload that can't be kept: its file (if any) and its row. */
async function discard(row: { id: string; storageKey: string | null }) {
  if (row.storageKey) await getStorageService().delete(row.storageKey).catch(() => undefined);
  await db.galleryPhoto.delete({ where: { id: row.id } }).catch(() => undefined);
}

/** Step 3: checks the stored file, makes the thumbnail and marks the photo READY. */
export async function completeUpload(businessId: string, userId: string, id: string, url: string): Promise<GalleryPhotoDto> {
  const row = await pending(businessId, id);
  const storage = getStorageService();
  try {
    // The URL must be the one this upload was allowed to write.
    if (!row.storageKey || storage.keyFromUrl(url) !== row.storageKey) throw invalid("missing");
    const data = await storage.read(row.storageKey);
    if (!data) throw invalid("missing");
    if (data.length > GALLERY_UPLOAD_MAX_BYTES) throw invalid("size");
    const extension = sniffImage(data);
    if (!extension) throw invalid("type");

    let meta: Metadata;
    let thumb: Buffer;
    try {
      meta = await sharp(data).metadata();
      thumb = await sharp(data).rotate().resize(GALLERY_THUMB_EDGE, GALLERY_THUMB_EDGE, { fit: "cover" }).webp({ quality: 75 }).toBuffer();
    } catch {
      throw invalid("unreadable");
    }
    // EXIF orientations 5–8 are rotated by a quarter turn.
    const turned = (meta.orientation ?? 1) >= 5;
    const stored = await storage.save({ data: thumb, contentType: "image/webp", prefix: THUMB_PREFIX, extension: "webp" });
    const ready = await db.galleryPhoto.update({
      where: { id: row.id },
      data: {
        status: "READY",
        url,
        contentType: CONTENT_TYPES[extension],
        bytes: data.length,
        width: (turned ? meta.height : meta.width) ?? null,
        height: (turned ? meta.width : meta.height) ?? null,
        thumbKey: stored.key,
        thumbUrl: stored.url,
        createdAt: new Date(),
      },
      select: { id: true, url: true, thumbUrl: true, title: true, createdAt: true },
    });
    await logActivity({ businessId, userId, action: "gallery.upload", details: { photoId: ready.id, bytes: data.length } });
    return {
      id: ready.id,
      source: "upload",
      sample: false,
      url: ready.url,
      thumbUrl: ready.thumbUrl,
      title: ready.title,
      createdAt: ready.createdAt.toISOString(),
      favorite: false,
      albumIds: [],
      draftId: null,
    };
  } catch (error) {
    await discard(row);
    throw error;
  }
}

/**
 * Daily cron: uploads that never finished (older than GALLERY_PENDING_TTL_MS) and own photos removed more
 * than GALLERY_REMOVE_GRACE_MS ago are deleted with their files. Gallery / AI chat drafts left without any
 * photo go too. Instagram and sample photos are never deleted (they only stay hidden).
 */
export async function purgeGallery(now = new Date()): Promise<{ deleted: number }> {
  const rows = await db.galleryPhoto.findMany({
    where: {
      OR: [
        { status: "PENDING", createdAt: { lt: new Date(now.getTime() - GALLERY_PENDING_TTL_MS) } },
        { status: "READY", source: { in: ["UPLOADED", "AI_GENERATED"] }, sampleKey: null, removedAt: { lt: new Date(now.getTime() - GALLERY_REMOVE_GRACE_MS) } },
      ],
    },
    select: { id: true, storageKey: true, thumbKey: true },
    take: 500,
  });
  if (!rows.length) return { deleted: 0 };
  const ids = new Set(rows.map((r) => r.id));
  const drafts = await db.postDraft.findMany({
    where: { ...GALLERY_DRAFT_WHERE, photos: { some: { photoId: { in: [...ids] } } } },
    select: { id: true, photos: { select: { photoId: true } } },
  });
  const emptied = drafts.filter((d) => d.photos.every((p) => ids.has(p.photoId))).map((d) => d.id);
  if (emptied.length) await db.postDraft.deleteMany({ where: { id: { in: emptied } } });

  const storage = getStorageService();
  for (const row of rows) {
    for (const key of [row.storageKey, row.thumbKey]) if (key) await storage.delete(key).catch((error) => console.warn("[gallery] couldn't delete a file", key, (error as Error).message));
  }
  const { count } = await db.galleryPhoto.deleteMany({ where: { id: { in: [...ids] } } });
  return { deleted: count };
}
