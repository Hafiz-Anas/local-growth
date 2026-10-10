import { db } from "@/lib/db";
import { logActivity } from "@/lib/server/activity";
import { BRAND_POST_SELECT, deleteUploadIfUnused, findOwnBrandPost, toBrandPost } from "@/lib/server/brand";
import { isOnboarding, mediaFromInstagram, receivePostUpload } from "@/lib/server/brand-posts";
import { requireBusiness } from "@/lib/server/guards";
import { ApiError, handler, ok, readJson, readParams } from "@/lib/server/http";
import { replaceBrandMediaSchema } from "@/lib/validation/api";

/**
 * PUT /api/brand/posts/:id/media — replace a post's picture or video, keeping its
 * purpose and note: JSON { igMediaId } from the connected account, or a
 * multipart upload ("file", optional "caption").
 */
export const PUT = handler(async (request, context: RouteContext<"/api/brand/posts/[id]/media">) => {
  const { businessId, session } = await requireBusiness();
  const { id } = await readParams(context, "id");
  const before = await findOwnBrandPost(businessId, id);

  const isUpload = (request.headers.get("content-type") ?? "").startsWith("multipart/form-data");
  let row;
  if (isUpload) {
    const { upload, stored } = await receivePostUpload(request, businessId, await isOnboarding(businessId));
    const caption = typeof upload.fields.caption === "string" ? upload.fields.caption.trim().slice(0, 2200) : undefined;
    row = await db.brandPost.update({
      where: { id },
      data: { source: "UPLOAD", igMediaId: null, mediaUrl: stored.url, mediaType: upload.kind === "video" ? "VIDEO" : "IMAGE", ...(caption !== undefined && { caption }) },
      select: BRAND_POST_SELECT,
    });
  } else {
    const { igMediaId } = await readJson(request, replaceBrandMediaSchema);
    const media = await mediaFromInstagram(businessId, igMediaId);
    if (await db.brandPost.count({ where: { businessId, igMediaId: media.igMediaId, id: { not: id } } })) {
      throw new ApiError(409, "conflict", "You've already added this post.", [{ path: "igMediaId", message: "already_added" }]);
    }
    row = await db.brandPost.update({ where: { id }, data: { source: "INSTAGRAM", ...media }, select: BRAND_POST_SELECT });
  }
  if (before.source === "UPLOAD" && before.mediaUrl !== row.mediaUrl) await deleteUploadIfUnused(before.mediaUrl);
  await logActivity({ businessId, userId: session.userId, action: "brand_post.replaced", details: { source: row.source.toLowerCase() } });
  return ok(toBrandPost(row));
});
