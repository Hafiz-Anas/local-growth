import { getBrandProfile } from "@/lib/server/brand";
import { requireBusiness } from "@/lib/server/guards";
import { handler, ok } from "@/lib/server/http";

/** GET /api/brand — Settings → Brand profile: current brand context, its versions, posts and basics. */
export const GET = handler(async () => {
  const { businessId } = await requireBusiness();
  return ok(await getBrandProfile(businessId));
});
