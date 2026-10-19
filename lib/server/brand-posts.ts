import "server-only";
import { MAX_BRAND_POSTS, ONBOARDING_POST_SLOTS, UPLOAD_LIMITS } from "@/config/onboarding";
import { db } from "@/lib/db";
import type { MediaType } from "@/lib/generated/prisma/client";
import { getInstagramService } from "@/lib/services/instagram";
import { CONTENT_TYPES, getStorageService, type StoredFile } from "@/lib/services/storage";
import { ApiError } from "./http";
import { getInstagramAccount } from "./instagram-account";
import { recordError } from "./onboarding";
import { readUpload, type UploadedFile } from "./uploads";

/** Whether the business is still in the wizard (uploads/limits/events differ). */
export async function isOnboarding(businessId: string): Promise<boolean> {
  const row = await db.business.findUnique({ where: { id: businessId }, select: { onboardingStatus: true } });
  return row?.onboardingStatus === "IN_PROGRESS";
}

/** 5 posts while onboarding, up to 12 afterwards. */
export async function assertRoomForPost(businessId: string, onboarding: boolean) {
  const limit = onboarding ? ONBOARDING_POST_SLOTS : MAX_BRAND_POSTS;
  if ((await db.brandPost.count({ where: { businessId } })) >= limit) {
    throw new ApiError(409, "conflict", `You can add up to ${limit} posts.`, [{ path: "posts", message: "limit_reached" }]);
  }
}

/** First free slot (0-based) — keeps the onboarding grid in the order the slots were filled. */
export async function nextOrder(businessId: string): Promise<number> {
  const used = new Set((await db.brandPost.findMany({ where: { businessId }, select: { order: true } })).map((p) => p.order));
  let order = 0;
  while (used.has(order)) order += 1;
  return order;
}

export interface MediaFields {
  mediaUrl: string | null;
  mediaType: MediaType;
  igMediaId: string | null;
  caption: string;
}

/** A post from the business's own connected account (the id must be one of its recent posts). */
export async function mediaFromInstagram(businessId: string, igMediaId: string): Promise<MediaFields> {
  const account = await getInstagramAccount(businessId);
  if (!account.connected) throw new ApiError(409, "instagram_not_connected", "Connect Instagram to pick from your posts.");
  const media = await getInstagramService().getMedia(account, { limit: 50 });
  const item = media.find((m) => m.id === igMediaId);
  if (!item) throw new ApiError(404, "not_found", "That post isn't on your account anymore.", [{ path: "igMediaId", message: "no_such_media" }]);
  // Meta's CDN links expire after a while: keep our own copy of the image (or video thumbnail).
  const mediaUrl = account.provider === "meta" ? ((await copyRemoteImage(item.mediaUrl)) ?? item.mediaUrl) : item.mediaUrl;
  return { mediaUrl, mediaType: item.mediaType === "video" ? "VIDEO" : "IMAGE", igMediaId: item.id, caption: item.caption };
}

const REMOTE_IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** Downloads an Instagram CDN image into storage; null when it can't (the caller keeps the remote URL). */
async function copyRemoteImage(url: string | null): Promise<string | null> {
  if (!url?.startsWith("https://")) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000), cache: "no-store" });
    const type = (response.headers.get("content-type") ?? "").split(";")[0].trim();
    const extension = REMOTE_IMAGE_TYPES[type];
    if (!response.ok || !extension) return null;
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length > UPLOAD_LIMITS.image) return null;
    return (await getStorageService().save({ data, contentType: type, prefix: "brand-posts", extension })).url;
  } catch (error) {
    console.warn("[brand-posts] couldn't copy the Instagram image", (error as Error).message);
    return null;
  }
}

/**
 * Reads a brand-post upload (JPG/PNG/WebP up to 8 MB, MP4 up to 50 MB, checked
 * by content) and stores it. Failed uploads during onboarding are recorded.
 */
export async function receivePostUpload(request: Request, businessId: string, onboarding: boolean): Promise<{ upload: UploadedFile; stored: StoredFile }> {
  let upload: UploadedFile;
  try {
    upload = await readUpload(request, { imageMax: UPLOAD_LIMITS.image, videoMax: UPLOAD_LIMITS.video, labels: { image: "8 MB", video: "50 MB" } });
  } catch (error) {
    if (onboarding) await recordError(businessId, "business", { kind: "upload", code: (error as { code?: string }).code ?? "unknown" });
    throw error;
  }
  const stored = await getStorageService().save({ data: upload.data, contentType: CONTENT_TYPES[upload.extension], prefix: "brand-posts", extension: upload.extension });
  return { upload, stored };
}
