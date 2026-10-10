import "server-only";
import { sniffImage, sniffVideo, type ImageExtension } from "@/lib/uploads/sniff";
import { ApiError } from "./http";

export { sniffImage, sniffVideo, type ImageExtension };
export type MediaExtension = ImageExtension | "mp4";

export interface ReadUploadOptions {
  /** Byte limit for images. */
  imageMax: number;
  /** Byte limit for videos; omit to accept images only. */
  videoMax?: number;
  /** Human-readable limits for error messages, e.g. "8 MB". */
  labels: { image: string; video?: string };
}

export interface UploadedFile {
  data: Buffer;
  extension: MediaExtension;
  kind: "image" | "video";
  /** Other multipart fields, as strings. */
  fields: Record<string, string>;
}

/**
 * Reads a multipart upload (field "file") and checks it by content: JPG, PNG or
 * WebP images, and — when `videoMax` is set — MP4 videos. Size limits are
 * checked against the declared length first so oversized bodies fail fast.
 */
export async function readUpload(request: Request, options: ReadUploadOptions): Promise<UploadedFile> {
  const largest = Math.max(options.imageMax, options.videoMax ?? 0);
  const declared = Number(request.headers.get("content-length") ?? 0);
  const tooLarge = () =>
    new ApiError(413, "payload_too_large", options.videoMax ? `Images can be up to ${options.labels.image} and videos up to ${options.labels.video}.` : `The image must be ${options.labels.image} or smaller.`);
  if (declared > largest + 64 * 1024) throw tooLarge();

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new ApiError(400, "validation_error", 'Send the file as multipart/form-data in the "file" field.');
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new ApiError(400, "validation_error", 'Send the file in the "file" field.');
  if (file.size === 0) throw new ApiError(400, "validation_error", "The file is empty.");
  if (file.size > largest) throw tooLarge();

  const data = Buffer.from(await file.arrayBuffer());
  const image = sniffImage(data);
  const video = options.videoMax ? sniffVideo(data) : null;
  if (!image && !video) {
    throw new ApiError(415, "unsupported_media_type", options.videoMax ? "Use a JPG, PNG or WebP image, or an MP4 video." : "Use a JPG, PNG or WebP image.");
  }
  if (image && data.length > options.imageMax) throw tooLarge();
  if (video && data.length > options.videoMax!) throw tooLarge();

  const fields: Record<string, string> = {};
  for (const [key, value] of form.entries()) if (typeof value === "string") fields[key] = value;
  return image ? { data, extension: image, kind: "image", fields } : { data, extension: video!, kind: "video", fields };
}
