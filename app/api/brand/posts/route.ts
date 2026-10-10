import { db } from "@/lib/db";
import { logActivity } from "@/lib/server/activity";
import { BRAND_POST_SELECT, listBrandPosts, toBrandPost, toDbPurpose } from "@/lib/server/brand";
import { assertRoomForPost, isOnboarding, mediaFromInstagram, nextOrder, receivePostUpload } from "@/lib/server/brand-posts";
import { requireBusiness } from "@/lib/server/guards";
import { ApiError, handler, ok, readJson } from "@/lib/server/http";
import { getStorageService } from "@/lib/services/storage";
import { brandPostFromInstagramSchema, brandPostUploadFields } from "@/lib/validation/api";

/** GET /api/brand/posts — the business's example posts, in grid order. */
export const GET = handler(async () => {
  const { businessId } = await requireBusiness();
  return ok(await listBrandPosts(businessId));
});

/**
 * POST /api/brand/posts — add an example post, either
 *  - JSON { igMediaId, purpose, purposeOther?, purposeNote?, caption?, order? } picked from the connected account, or
 *  - multipart/form-data: "file" (JPG/PNG/WebP ≤ 8 MB, MP4 ≤ 50 MB) + caption, purpose, purposeOther, purposeNote, order.
 * Five posts during onboarding, up to twelve afterwards.
 */
export const POST = handler(async (request) => {
  const { businessId, session } = await requireBusiness();
  const onboarding = await isOnboarding(businessId);
  await assertRoomForPost(businessId, onboarding);

  const isUpload = (request.headers.get("content-type") ?? "").startsWith("multipart/form-data");
  let row;
  if (isUpload) {
    const { upload, stored } = await receivePostUpload(request, businessId, onboarding);
    const parsed = brandPostUploadFields.safeParse(upload.fields);
    if (!parsed.success) {
      await getStorageService().delete(stored.key);
      throw new ApiError(400, "validation_error", "Invalid input.", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    }
    const fields = parsed.data;
    row = await db.brandPost.create({
      data: {
        businessId,
        source: "UPLOAD",
        mediaUrl: stored.url,
        mediaType: upload.kind === "video" ? "VIDEO" : "IMAGE",
        caption: fields.caption,
        purpose: toDbPurpose(fields.purpose),
        purposeOther: fields.purpose === "other" ? fields.purposeOther : null,
        purposeNote: fields.purposeNote,
        order: fields.order ?? (await nextOrder(businessId)),
      },
      select: BRAND_POST_SELECT,
    });
  } else {
    const input = await readJson(request, brandPostFromInstagramSchema);
    const media = await mediaFromInstagram(businessId, input.igMediaId);
    if (await db.brandPost.count({ where: { businessId, igMediaId: media.igMediaId } })) {
      throw new ApiError(409, "conflict", "You've already added this post.", [{ path: "igMediaId", message: "already_added" }]);
    }
    row = await db.brandPost.create({
      data: {
        businessId,
        source: "INSTAGRAM",
        ...media,
        caption: input.caption ?? media.caption,
        purpose: toDbPurpose(input.purpose),
        purposeOther: input.purpose === "other" ? input.purposeOther : null,
        purposeNote: input.purposeNote,
        order: input.order ?? (await nextOrder(businessId)),
      },
      select: BRAND_POST_SELECT,
    });
  }
  await logActivity({ businessId, userId: session.userId, action: "brand_post.added", details: { source: row.source.toLowerCase(), purpose: row.purpose.toLowerCase() } });
  return ok(toBrandPost(row), { status: 201 });
});
