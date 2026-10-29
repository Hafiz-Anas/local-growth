/**
 * Gallery upload rules, shared by the browser (checks and resizing before upload,
 * lib/gallery/upload-client.ts) and the server (lib/server/gallery-uploads.ts, which checks the stored
 * bytes again). Pure (no server-only) so the tests import it.
 *
 * Photos are made smaller in the browser and then sent straight to storage (Vercel Blob), never through
 * our API, so Vercel's 4.5 MB request limit doesn't apply.
 */

/** A picked file can be up to this big; it's resized before upload. */
export const GALLERY_PICK_MAX_BYTES = 25 * 1024 * 1024;
/** What reaches storage (after resizing): checked again on the server. */
export const GALLERY_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
/** Photos are resized to fit within this many pixels on their long side. */
export const GALLERY_MAX_EDGE = 2048;
/** Thumbnails for the grid (server-made, WebP). */
export const GALLERY_THUMB_EDGE = 480;
/** Photos per upload batch. */
export const GALLERY_MAX_BATCH = 30;
/** Files sent at the same time. */
export const GALLERY_UPLOAD_PARALLEL = 3;
/** A small, already-JPEG photo within GALLERY_MAX_EDGE is uploaded as it is. */
export const GALLERY_KEEP_ORIGINAL_BYTES = 1.5 * 1024 * 1024;
/** Albums per business and the longest album name. */
export const GALLERY_MAX_ALBUMS = 100;
export const GALLERY_ALBUM_NAME_MAX = 40;
/** Undo window for a removed photo: the daily cron deletes its file after this. */
export const GALLERY_REMOVE_GRACE_MS = 24 * 60 * 60 * 1000;
/** An upload that never finished is cleared after this. */
export const GALLERY_PENDING_TTL_MS = 60 * 60 * 1000;
/** Earlier captions kept on a Gallery / AI chat draft. */
export const GALLERY_CAPTION_VERSIONS = 10;

export const GALLERY_UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type GalleryUploadType = (typeof GALLERY_UPLOAD_TYPES)[number];
export const GALLERY_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif";

const EXTENSIONS: Record<GalleryUploadType, "jpg" | "png" | "webp"> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
export const extensionFor = (type: GalleryUploadType) => EXTENSIONS[type];
export const isUploadType = (type: string): type is GalleryUploadType => (GALLERY_UPLOAD_TYPES as readonly string[]).includes(type);

/** Why a picked file can't be used: no bytes, not an image we can read, or too big even to resize. */
export type PickProblem = "empty" | "type" | "size";

const PICK_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "heic", "heif"];
const PICK_TYPES = new Set([...GALLERY_UPLOAD_TYPES, "image/heic", "image/heif"]);

/**
 * Quick check of a picked file (name/type/size). HEIC/HEIF from iPhones passes: the browser converts it to
 * JPEG when it can read it, else the resize step reports "type".
 */
export function checkPickedPhoto(file: { name: string; type: string; size: number }): PickProblem | null {
  if (file.size === 0) return "empty";
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  const typeOk = file.type ? PICK_TYPES.has(file.type) : PICK_EXTENSIONS.includes(extension);
  if (!typeOk) return "type";
  if (file.size > GALLERY_PICK_MAX_BYTES) return "size";
  return null;
}

/** Whether a picked photo can go up as it is (small JPEG within the size), else it's redrawn smaller. */
export function keepsOriginal(file: { type: string; size: number }, width: number, height: number): boolean {
  return file.type === "image/jpeg" && file.size <= GALLERY_KEEP_ORIGINAL_BYTES && Math.max(width, height) <= GALLERY_MAX_EDGE;
}

/** Width and height that fit within `max` on the long side, never enlarged. */
export function fitWithin(width: number, height: number, max = GALLERY_MAX_EDGE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

const CAMERA_NAME = /^(img|dsc|dscn|dscf|pxl|mvimg|image|photo|screenshot|screen shot|whatsapp image)[\s\d.:at]*$/i;

/** A photo's title from its file name: no extension, separators as spaces, at most 60 characters. "" for camera names. */
export function titleFromName(name: string): string {
  const base = name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  // Camera, screenshot and chat-app names (IMG 1234, DSC0001, PXL 20261029…, WhatsApp Image 2026 10 29 at 9.41.03) say nothing.
  if (CAMERA_NAME.test(base) || !/\p{L}/u.test(base)) return "";
  return base.slice(0, 60);
}

/** Runs `task` over `items`, at most `limit` at a time, keeping each result in place. */
export async function mapLimited<T, R>(items: T[], limit: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
