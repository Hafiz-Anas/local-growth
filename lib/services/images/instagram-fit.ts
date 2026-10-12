import sharp from "sharp";

/**
 * Instagram's rules for a single-image post published through the API: JPEG
 * only, aspect ratio between 4:5 (portrait) and 1.91:1 (landscape), at most
 * 8 MB. Wider than 1440 px is downscaled by Instagram anyway.
 * Pure (no server-only) so tests can run it.
 */
export const IG_MIN_RATIO = 4 / 5;
export const IG_MAX_RATIO = 1.91;
export const IG_MAX_WIDTH = 1440;
export const IG_MAX_BYTES = 8 * 1024 * 1024;

export interface CropBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Centre crop to the nearest allowed aspect ratio, or null when the image already fits. */
export function cropForInstagram(width: number, height: number): CropBox | null {
  const ratio = width / height;
  if (ratio < IG_MIN_RATIO) {
    const h = Math.min(height, Math.round(width / IG_MIN_RATIO));
    return { left: 0, top: Math.floor((height - h) / 2), width, height: h };
  }
  if (ratio > IG_MAX_RATIO) {
    const w = Math.min(width, Math.round(height * IG_MAX_RATIO));
    return { left: Math.floor((width - w) / 2), top: 0, width: w, height };
  }
  return null;
}

/**
 * A JPEG Instagram accepts: EXIF orientation applied, centre-cropped into the
 * allowed aspect ratios, at most 1440 px wide, transparency flattened onto white,
 * and under 8 MB. Throws when the input isn't a readable image.
 */
export async function toInstagramJpeg(input: Buffer): Promise<{ data: Buffer; width: number; height: number; cropped: boolean }> {
  const { data: upright, info } = await sharp(input, { failOn: "error" }).rotate().toBuffer({ resolveWithObject: true });
  const crop = cropForInstagram(info.width, info.height);
  const base = () => {
    let image = sharp(upright);
    if (crop) image = image.extract(crop);
    return image.resize({ width: IG_MAX_WIDTH, withoutEnlargement: true }).flatten({ background: "#ffffff" });
  };
  for (const quality of [90, 80, 70, 60]) {
    const { data, info: out } = await base().jpeg({ quality, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    if (data.length <= IG_MAX_BYTES || quality === 60) return { data, width: out.width, height: out.height, cropped: Boolean(crop) };
  }
  throw new Error("unreachable");
}
