import { UPLOAD_LIMITS } from "@/config/onboarding";
import { ApiError, handler, ok } from "@/lib/server/http";
import { recordError, requireOnboarding } from "@/lib/server/onboarding";
import { getRateLimiter, STYLE_UPLOAD_LIMIT } from "@/lib/server/rate-limit";
import { STYLE_UPLOAD_PREFIX } from "@/lib/server/style-guide";
import { readUpload } from "@/lib/server/uploads";
import { CONTENT_TYPES, getStorageService } from "@/lib/services/storage";

/**
 * POST /api/onboarding/style/photos — multipart "file": a photo from the phone for "Your style"
 * (JPG, PNG or WebP up to 8 MB, checked by content). Answers its URL; it counts once the step is
 * saved with it (PUT /api/onboarding/style), and photos left out are removed then.
 */
export const POST = handler(async (request) => {
  const { businessId } = await requireOnboarding();
  if (!(await getRateLimiter().consume(STYLE_UPLOAD_LIMIT, businessId))) throw new ApiError(429, "rate_limited", "Too many uploads. Please try again later.");
  let upload;
  try {
    upload = await readUpload(request, { imageMax: UPLOAD_LIMITS.image, labels: { image: "8 MB" } });
  } catch (error) {
    await recordError(businessId, "style", { kind: "upload", code: (error as { code?: string }).code ?? "unknown" });
    throw error;
  }
  const stored = await getStorageService().save({ data: upload.data, contentType: CONTENT_TYPES[upload.extension], prefix: STYLE_UPLOAD_PREFIX, extension: upload.extension });
  return ok({ url: stored.url }, { status: 201 });
});
