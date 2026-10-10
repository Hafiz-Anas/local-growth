import "server-only";
import { randomInt } from "node:crypto";
import { db } from "@/lib/db";
import type { DraftImageSource } from "@/lib/generated/prisma/client";
import { getImageService, ImageGenerationError, imageProvider } from "@/lib/services/image";
import { buildImagePrompt } from "@/lib/services/images/prompt";
import { CONTENT_TYPES, getStorageService } from "@/lib/services/storage";
import { POST_IMAGE_MAX_BYTES } from "@/lib/uploads/sniff";
import type { PostDraftDto } from "@/types";
import { logActivity } from "./activity";
import { currentBrandContext, deleteUploadIfUnused } from "./brand";
import { catalogFor } from "./data";
import { DRAFT_SELECT, toDraft } from "./dto";
import { ApiError, notFound } from "./http";
import { logIntegration } from "./integration-log";
import { getRateLimiter, IMAGE_GENERATION_LIMIT } from "./rate-limit";
import { readUpload } from "./uploads";

/**
 * A post draft's image: AI-generated (ImageService) or uploaded by the user.
 * A draft has at most one; each replaces the other. Files go through the
 * StorageService like other media, and the old file is deleted once nothing
 * uses it. Queued posts get the new image too. Nothing here publishes.
 */

const STORAGE_PREFIX = "post-images";

async function editableDraft(businessId: string, id: string) {
  const draft = await db.postDraft.findFirst({
    where: { id, businessId },
    select: { id: true, status: true, caption: true, category: true, angle: true, imageUrl: true },
  });
  if (!draft) throw notFound("Draft");
  if (draft.status !== "DRAFT" && draft.status !== "QUEUED") throw new ApiError(409, "conflict", "Published or rejected drafts can't be changed.");
  return draft;
}

/** Saves the new image on the draft (and its still-scheduled post), then removes the old file if unused. */
async function setDraftImage(
  businessId: string,
  draft: { id: string; imageUrl: string | null },
  image: { url: string; source: DraftImageSource; prompt: string | null } | null,
): Promise<PostDraftDto> {
  const row = await db.$transaction(async (tx) => {
    const updated = await tx.postDraft.update({
      where: { id: draft.id },
      data: { imageUrl: image?.url ?? null, imageSource: image?.source ?? null, imagePrompt: image?.prompt ?? null },
      select: DRAFT_SELECT,
    });
    await tx.scheduledPost.updateMany({ where: { businessId, draftId: draft.id, status: "SCHEDULED" }, data: { mediaUrl: image?.url ?? null } });
    return updated;
  });
  if (draft.imageUrl && draft.imageUrl !== image?.url) await deleteUploadIfUnused(draft.imageUrl);
  return toDraft(row, await catalogFor(businessId));
}

/** The prompt for a draft: brand profile + caption + the post's purpose and product. */
async function promptFor(businessId: string, draft: { caption: string; category: string; angle: string }) {
  const [business, context, catalog] = await Promise.all([
    db.business.findUniqueOrThrow({ where: { id: businessId }, select: { name: true, businessType: true, businessTypeOther: true, location: true, brandColors: true } }),
    currentBrandContext(businessId),
    catalogFor(businessId),
  ]);
  const occasion = catalog.occasions.find((o) => o.id === draft.angle);
  const category = catalog.categories.find((c) => c.id === draft.category);
  const colors = context?.colors.length ? context.colors : business.brandColors;
  const prompt = buildImagePrompt({
    businessName: business.name,
    businessType: business.businessType === "other" ? business.businessTypeOther : business.businessType,
    location: business.location || null,
    brandSummary: context?.summary ?? null,
    visualStyle: context?.visualStyle ?? null,
    colors,
    purpose: occasion?.label ?? draft.angle,
    product: category?.label ?? null,
    caption: draft.caption,
  });
  return { prompt, colors };
}

const UNAVAILABLE_MESSAGES: Record<string, string> = {
  daily_limit: "The daily image limit has been reached. Try again tomorrow.",
  rate_limited: "Too many images were requested. Wait a minute and try again.",
  billing: "The image model needs billing enabled on the Google AI account.",
  invalid_key: "The Gemini API key is missing, invalid or not allowed to use this API.",
  not_configured: "Image generation isn't set up (GEMINI_API_KEY is missing).",
  region: "Image generation isn't available in this region.",
  model_unavailable: "The configured image model isn't available.",
  blocked: "The image was blocked by the provider's safety filters.",
  no_image: "The provider didn't return an image.",
  request_rejected: "The provider rejected the request.",
  unavailable: "The image service didn't answer. Try again in a moment.",
};

/** "Generate image" / "Regenerate": a new AI image for the draft. */
export async function generateDraftImage(businessId: string, userId: string, draftId: string): Promise<PostDraftDto> {
  const draft = await editableDraft(businessId, draftId);
  if (!(await getRateLimiter().consume(IMAGE_GENERATION_LIMIT, businessId))) {
    throw new ApiError(429, "image_unavailable", UNAVAILABLE_MESSAGES.rate_limited, [{ path: "image", message: "rate_limited" }]);
  }
  const { prompt, colors } = await promptFor(businessId, draft);
  const service = getImageService();

  let image;
  try {
    image = await service.generate({ prompt, colors, variant: randomInt(1, 1000) });
  } catch (error) {
    if (!(error instanceof ImageGenerationError)) throw error;
    await logIntegration({
      businessId,
      provider: service.provider,
      level: error.reason === "blocked" || error.reason === "daily_limit" || error.reason === "rate_limited" ? "warning" : "error",
      call: "image.generate",
      errorCode: error.reason,
      message: error.message,
      httpStatus: error.httpStatus,
      details: { draftId, providerCode: error.providerCode },
    });
    const status = error.reason === "daily_limit" || error.reason === "rate_limited" ? 429 : error.reason === "blocked" || error.reason === "no_image" ? 422 : 503;
    throw new ApiError(status, "image_unavailable", UNAVAILABLE_MESSAGES[error.reason] ?? "Image generation is unavailable.", [{ path: "image", message: error.reason }]);
  }

  const stored = await getStorageService().save({ data: image.data, contentType: CONTENT_TYPES[image.extension], prefix: STORAGE_PREFIX, extension: image.extension });
  const dto = await setDraftImage(businessId, draft, { url: stored.url, source: "GENERATED", prompt });
  await logActivity({ businessId, userId, action: "post.image_generated", details: { draftId, provider: imageProvider(), model: image.model, replaced: Boolean(draft.imageUrl) } });
  return dto;
}

/** "Upload image" / "Replace": the user's own JPG, PNG or WebP (up to 8 MB). */
export async function uploadDraftImage(businessId: string, userId: string, draftId: string, request: Request): Promise<PostDraftDto> {
  const draft = await editableDraft(businessId, draftId);
  const upload = await readUpload(request, { imageMax: POST_IMAGE_MAX_BYTES, labels: { image: "8 MB" } });
  if (upload.kind !== "image") throw new ApiError(415, "unsupported_media_type", "Use a JPG, PNG or WebP image.");
  const stored = await getStorageService().save({ data: upload.data, contentType: CONTENT_TYPES[upload.extension], prefix: STORAGE_PREFIX, extension: upload.extension });
  const dto = await setDraftImage(businessId, draft, { url: stored.url, source: "UPLOADED", prompt: null });
  await logActivity({ businessId, userId, action: "post.image_uploaded", details: { draftId, replaced: Boolean(draft.imageUrl) } });
  return dto;
}

/** "Remove": back to the placeholder. */
export async function removeDraftImage(businessId: string, userId: string, draftId: string): Promise<PostDraftDto> {
  const draft = await editableDraft(businessId, draftId);
  const dto = await setDraftImage(businessId, draft, null);
  if (draft.imageUrl) await logActivity({ businessId, userId, action: "post.image_removed", details: { draftId } });
  return dto;
}
