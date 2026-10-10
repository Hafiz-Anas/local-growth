import { db } from "@/lib/db";
import { extractColors } from "@/lib/server/colors";
import { requireBusiness } from "@/lib/server/guards";
import { handler, ok } from "@/lib/server/http";

/**
 * GET /api/brand/colors — 3–5 colour suggestions extracted on the server from
 * the business's example post images (and logo, when there is one).
 */
export const GET = handler(async () => {
  const { businessId } = await requireBusiness();
  const business = await db.business.findUnique({
    where: { id: businessId },
    select: { logoUrl: true, brandPosts: { where: { mediaType: "IMAGE" }, select: { mediaUrl: true }, orderBy: { order: "asc" } } },
  });
  const urls = [...(business?.brandPosts ?? []).map((p) => p.mediaUrl), business?.logoUrl].filter((u): u is string => Boolean(u));
  return ok({ colors: await extractColors(urls), fromImages: urls.length });
});
