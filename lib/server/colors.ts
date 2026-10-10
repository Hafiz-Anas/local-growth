import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { SUGGESTED_COLORS } from "@/config/onboarding";
import { getStorageService } from "@/lib/services/storage";

/**
 * Brand-colour suggestions from the business's post images, computed on the
 * server: each image is shrunk to 48×48, pixels are bucketed (4 bits per
 * channel), and the most common buckets that are clearly different from each
 * other become the palette. Videos are skipped (no frame decoding here).
 */

const MOCK_MEDIA = /^\/mock-media\/[a-z]+\.svg$/;

/** Bytes behind a media URL we serve ourselves; null for anything else. */
async function loadImage(url: string): Promise<Buffer | null> {
  const storage = getStorageService();
  const key = storage.keyFromUrl(url);
  if (key) return storage.read(key);
  // Stand-in images of the MOCK InstagramService (public/mock-media).
  if (MOCK_MEDIA.test(url)) return readFile(path.join(process.cwd(), "public", url)).catch(() => null);
  return null;
}

const toHex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

/** Weighted distance in RGB that roughly follows how different two colours look. */
function distance(a: [number, number, number], b: [number, number, number]) {
  const rMean = (a[0] + b[0]) / 2;
  const [dr, dg, db] = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  return Math.sqrt((2 + rMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rMean) / 256) * db * db);
}

interface Bucket {
  count: number;
  r: number;
  g: number;
  b: number;
}

export async function extractColors(urls: string[], max: number = SUGGESTED_COLORS.max): Promise<string[]> {
  const buckets = new Map<number, Bucket>();
  for (const url of urls) {
    const input = await loadImage(url);
    if (!input) continue;
    let pixels: Buffer;
    try {
      pixels = await sharp(input, { density: 72 }).resize(48, 48, { fit: "cover" }).removeAlpha().raw().toBuffer();
    } catch {
      continue; // unreadable image: skip it, the others still count
    }
    for (let i = 0; i + 2 < pixels.length; i += 3) {
      const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]];
      const id = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const bucket = buckets.get(id) ?? { count: 0, r: 0, g: 0, b: 0 };
      bucket.count += 1;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      buckets.set(id, bucket);
    }
  }

  const ranked = [...buckets.values()]
    .map((b) => ({ count: b.count, rgb: [b.r / b.count, b.g / b.count, b.b / b.count] as [number, number, number] }))
    .sort((a, b) => b.count - a.count);

  const picked: Array<[number, number, number]> = [];
  for (const { rgb } of ranked) {
    if (picked.every((p) => distance(p, rgb) > 90)) picked.push(rgb);
    if (picked.length >= max) break;
  }
  return picked.map(([r, g, b]) => toHex(r, g, b));
}
