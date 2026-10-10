import { db } from "@/lib/db";
import { logActivity } from "@/lib/server/activity";
import { BRAND_POST_SELECT, deleteUploadIfUnused, findOwnBrandPost, toBrandPost, toDbPurpose } from "@/lib/server/brand";
import { requireBusiness } from "@/lib/server/guards";
import { handler, ok, readJson, readParams } from "@/lib/server/http";
import { updateBrandPostSchema } from "@/lib/validation/api";

/** PATCH /api/brand/posts/:id  { caption?, purpose?, purposeOther?, purposeNote? } */
export const PATCH = handler(async (request, context: RouteContext<"/api/brand/posts/[id]">) => {
  const { businessId, session } = await requireBusiness();
  const { id } = await readParams(context, "id");
  await findOwnBrandPost(businessId, id);
  const patch = await readJson(request, updateBrandPostSchema);
  const row = await db.brandPost.update({
    where: { id },
    data: {
      ...(patch.caption !== undefined && { caption: patch.caption }),
      ...(patch.purpose && { purpose: toDbPurpose(patch.purpose), purposeOther: patch.purpose === "other" ? (patch.purposeOther ?? null) : null }),
      ...(patch.purpose === undefined && patch.purposeOther !== undefined && { purposeOther: patch.purposeOther }),
      ...(patch.purposeNote !== undefined && { purposeNote: patch.purposeNote }),
    },
    select: BRAND_POST_SELECT,
  });
  await logActivity({ businessId, userId: session.userId, action: "brand_post.updated", details: { fields: Object.keys(patch) } });
  return ok(toBrandPost(row));
});

/** DELETE /api/brand/posts/:id — removes the post (and its uploaded file). */
export const DELETE = handler(async (_request, context: RouteContext<"/api/brand/posts/[id]">) => {
  const { businessId, session } = await requireBusiness();
  const { id } = await readParams(context, "id");
  const post = await findOwnBrandPost(businessId, id);
  await db.brandPost.delete({ where: { id } });
  if (post.source === "UPLOAD") await deleteUploadIfUnused(post.mediaUrl);
  await logActivity({ businessId, userId: session.userId, action: "brand_post.removed" });
  return ok({ id });
});
