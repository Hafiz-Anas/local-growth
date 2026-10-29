import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { UPLOAD_LIMITS } from "@/config/onboarding";
import { getStorageService } from "@/lib/services/storage";

/** Images the AI looks at (style guide, photo captions): small JPEGs, read from our storage, public/ or Instagram's CDN. */

/** Longest side of an image sent to the text model. */
const ANALYSIS_SIDE = 768;

/** A small JPEG (upright, white behind transparency) for the text model, or null when it can't be read. */
export async function toAnalysisJpeg(input: Buffer): Promise<Buffer | null> {
  try {
    return await sharp(input).rotate().resize(ANALYSIS_SIDE, ANALYSIS_SIDE, { fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 80 }).toBuffer();
  } catch {
    return null;
  }
}

/** Bytes behind an image link: our storage, a bundled file under public/ (mock posts), or HTTPS (Instagram's CDN). */
export async function fetchImage(url: string | null): Promise<Buffer | null> {
  if (!url) return null;
  const storage = getStorageService();
  const key = storage.keyFromUrl(url);
  if (key) return storage.read(key);
  if (url.startsWith("/") && !url.startsWith("//")) {
    const root = path.resolve(process.cwd(), "public");
    const file = path.resolve(root, `.${decodeURIComponent(url.split("?")[0])}`);
    if (!file.startsWith(root + path.sep)) return null;
    return readFile(file).catch(() => null);
  }
  if (!url.startsWith("https://")) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000), cache: "no-store" });
    if (!response.ok || !(response.headers.get("content-type") ?? "").startsWith("image/")) return null;
    const data = Buffer.from(await response.arrayBuffer());
    return data.length <= UPLOAD_LIMITS.image ? data : null;
  } catch {
    return null;
  }
}
