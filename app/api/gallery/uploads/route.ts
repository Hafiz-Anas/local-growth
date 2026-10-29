import { startUploads } from "@/lib/server/gallery-uploads";
import { requireAnyFeature } from "@/lib/server/guards";
import { ApiError, handler, ok, readJson } from "@/lib/server/http";
import { GALLERY_UPLOAD_LIMIT, getRateLimiter } from "@/lib/server/rate-limit";
import { galleryUploadStartSchema } from "@/lib/validation/api";

/**
 * POST /api/gallery/uploads { files: [{ name, type, size }] } — one upload permission per photo (already
 * resized in the browser). The files go straight to storage, not through this API (lib/server/gallery-uploads.ts).
 */
export const POST = handler(async (request) => {
  const { businessId, session } = await requireAnyFeature("gallery", "aiChat");
  const { files } = await readJson(request, galleryUploadStartSchema);
  const limiter = getRateLimiter();
  for (let i = 0; i < files.length; i++) {
    if (!(await limiter.consume(GALLERY_UPLOAD_LIMIT, businessId))) throw new ApiError(429, "rate_limited", "Too many uploads. Please try again later.");
  }
  return ok(await startUploads(businessId, session.userId, files), { status: 201 });
});
