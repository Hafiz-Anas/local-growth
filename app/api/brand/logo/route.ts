import { UPLOAD_LIMITS } from "@/config/onboarding";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/server/activity";
import { deleteUploadIfUnused } from "@/lib/server/brand";
import { isOnboarding } from "@/lib/server/brand-posts";
import { requireBusiness } from "@/lib/server/guards";
import { handler, ok } from "@/lib/server/http";
import { recordError } from "@/lib/server/onboarding";
import { readUpload } from "@/lib/server/uploads";
import { CONTENT_TYPES, getStorageService } from "@/lib/services/storage";

/** POST /api/brand/logo  (multipart "file": JPG, PNG or WebP up to 2 MB) — optional logo for the brand profile. */
export const POST = handler(async (request) => {
  const { businessId, session } = await requireBusiness();
  let upload;
  try {
    upload = await readUpload(request, { imageMax: UPLOAD_LIMITS.logo, labels: { image: "2 MB" } });
  } catch (error) {
    if (await isOnboarding(businessId)) await recordError(businessId, "brand", { kind: "logo_upload", code: (error as { code?: string }).code ?? "unknown" });
    throw error;
  }
  const storage = getStorageService();
  const stored = await storage.save({ data: upload.data, contentType: CONTENT_TYPES[upload.extension], prefix: "brand-logos", extension: upload.extension });
  const before = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { logoUrl: true } });
  await db.business.update({ where: { id: businessId }, data: { logoUrl: stored.url } });
  await deleteUploadIfUnused(before.logoUrl);
  await logActivity({ businessId, userId: session.userId, action: "brand.logo_updated" });
  return ok({ logoUrl: stored.url });
});

/** DELETE /api/brand/logo */
export const DELETE = handler(async () => {
  const { businessId, session } = await requireBusiness();
  const before = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { logoUrl: true } });
  await db.business.update({ where: { id: businessId }, data: { logoUrl: null } });
  await deleteUploadIfUnused(before.logoUrl);
  await logActivity({ businessId, userId: session.userId, action: "brand.logo_removed" });
  return ok({ logoUrl: null });
});
