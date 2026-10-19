import { logActivity } from "@/lib/server/activity";
import { getBusinessDetails, saveBusinessDetails } from "@/lib/server/business-details";
import { requireBusiness } from "@/lib/server/guards";
import { handler, ok, readJson } from "@/lib/server/http";
import { businessDetailsSchema } from "@/lib/validation/api";

/** GET /api/brand/business — Settings → Business: the name, products / menu categories and the location in Kuwait. */
export const GET = handler(async () => {
  const { businessId } = await requireBusiness();
  return ok(await getBusinessDetails(businessId));
});

/** PUT /api/brand/business  { name, products?, governorate, area, serviceMode } — the name came from Instagram at sign-up. */
export const PUT = handler(async (request) => {
  const { businessId, session } = await requireBusiness();
  const input = await readJson(request, businessDetailsSchema);
  await saveBusinessDetails(businessId, input);
  await logActivity({ businessId, userId: session.userId, action: "business.details_updated" });
  return ok(await getBusinessDetails(businessId));
});
