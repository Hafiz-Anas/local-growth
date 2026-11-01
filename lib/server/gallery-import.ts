import "server-only";
import { db } from "@/lib/db";
import { getStorageService } from "@/lib/services/storage";
import { CONTENT_TYPES } from "@/lib/services/storage-core";
import { sniffImage } from "@/lib/uploads/sniff";
import { THUMB_PREFIX, makeThumbnail } from "./gallery-thumbs";

/**
 * The owner's photos uploaded elsewhere — onboarding "Your style" and Settings → brand posts — also go into
 * the Gallery as Uploaded photos (same file, no copy), once each: a file already in the Gallery (by storage key
 * or URL, removed or not) is skipped, so saving again or running the backfill again adds nothing. Videos and
 * files that aren't ours (Instagram links, bundled images) are skipped. Never throws: the upload that triggered
 * it has already succeeded.
 */
export async function addUploadsToGallery(businessId: string, urls: Array<string | null | undefined>, userId: string | null = null): Promise<number> {
  const storage = getStorageService();
  let added = 0;
  for (const url of new Set(urls.filter((u): u is string => Boolean(u)))) {
    try {
      const key = storage.keyFromUrl(url);
      if (!key) continue;
      if (await db.galleryPhoto.count({ where: { businessId, OR: [{ storageKey: key }, { url }] } })) continue;
      const data = await storage.read(key);
      if (!data) continue;
      const extension = sniffImage(data);
      if (!extension) continue;
      const { thumb, width, height } = await makeThumbnail(data);
      const stored = await storage.save({ data: thumb, contentType: "image/webp", prefix: THUMB_PREFIX, extension: "webp" });
      await db.galleryPhoto.create({
        data: {
          businessId,
          source: "UPLOADED",
          status: "READY",
          storageKey: key,
          url,
          thumbKey: stored.key,
          thumbUrl: stored.url,
          contentType: CONTENT_TYPES[extension],
          bytes: data.length,
          width,
          height,
          uploadedBy: userId,
        },
      });
      added += 1;
    } catch (error) {
      console.warn("[gallery] couldn't add an upload to the Gallery", (error as Error)?.message);
    }
  }
  return added;
}

/** Every earlier "Your style" and brand-post photo of a business (the one-off backfill, scripts/backfill-gallery-uploads.ts). */
export async function backfillBusinessUploads(businessId: string): Promise<number> {
  const [style, posts] = await Promise.all([
    db.styleGuide.findUnique({ where: { businessId }, select: { photos: true } }),
    db.brandPost.findMany({ where: { businessId, source: "UPLOAD", mediaType: "IMAGE" }, select: { mediaUrl: true }, orderBy: { order: "asc" } }),
  ]);
  const stylePhotos = Array.isArray(style?.photos) ? (style.photos as Array<{ source?: unknown; url?: unknown }>) : [];
  const styleUrls = stylePhotos.flatMap((p) => (p?.source === "upload" && typeof p.url === "string" ? [p.url] : []));
  return addUploadsToGallery(businessId, [...styleUrls, ...posts.map((p) => p.mediaUrl)]);
}
