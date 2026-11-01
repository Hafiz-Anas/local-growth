import "server-only";
import sharp from "sharp";
import { GALLERY_THUMB_EDGE } from "@/lib/gallery/uploads";

/** Gallery thumbnails live under this storage prefix. */
export const THUMB_PREFIX = "gallery-thumbs";

/**
 * The Gallery's 480 px WebP thumbnail of a photo and its upright size (EXIF orientations 5–8 are a quarter
 * turn). Throws when the bytes aren't a readable image.
 */
export async function makeThumbnail(data: Buffer): Promise<{ thumb: Buffer; width: number | null; height: number | null }> {
  const meta = await sharp(data).metadata();
  const thumb = await sharp(data).rotate().resize(GALLERY_THUMB_EDGE, GALLERY_THUMB_EDGE, { fit: "cover" }).webp({ quality: 75 }).toBuffer();
  const turned = (meta.orientation ?? 1) >= 5;
  return { thumb, width: (turned ? meta.height : meta.width) ?? null, height: (turned ? meta.width : meta.height) ?? null };
}
