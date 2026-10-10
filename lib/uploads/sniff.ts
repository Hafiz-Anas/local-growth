/**
 * File-type checks by content (the browser's MIME type is not trusted), plus
 * the post-image rules the Post Generator checks in the browser before
 * uploading. Pure (no server-only) so the server, the browser and the tests
 * share one implementation.
 */

export type ImageExtension = "jpg" | "png" | "webp";

/** Detects the real image type from the file's first bytes. */
export function sniffImage(bytes: Uint8Array): ImageExtension | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && png.every((b, i) => bytes[i] === b)) return "png";
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  return null;
}

/** MP4 (ISO base media): an "ftyp" box at offset 4 with a known MP4 brand. */
export function sniffVideo(bytes: Uint8Array): "mp4" | null {
  if (bytes.length < 12 || String.fromCharCode(...bytes.subarray(4, 8)) !== "ftyp") return null;
  const brand = String.fromCharCode(...bytes.subarray(8, 12));
  return /^(isom|iso[2-9]|mp4[12]|avc1|M4V |mmp4|dash|f4v )$/.test(brand) ? "mp4" : null;
}

/** Post images: JPG, PNG or WebP up to 8 MB. */
export const POST_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const POST_IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";
const POST_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type ImageFileProblem = "empty" | "type" | "size";

/**
 * Quick check in the browser before uploading (name/type/size only). The
 * server checks the bytes again with sniffImage.
 */
export function checkImageFile(file: { name: string; type: string; size: number }, maxBytes = POST_IMAGE_MAX_BYTES): ImageFileProblem | null {
  if (file.size === 0) return "empty";
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  const typeOk = file.type ? POST_IMAGE_TYPES.has(file.type) : ["jpg", "jpeg", "png", "webp"].includes(extension);
  if (!typeOk) return "type";
  if (file.size > maxBytes) return "size";
  return null;
}
