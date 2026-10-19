import { logActivity } from "@/lib/server/activity";
import { requireBusiness } from "@/lib/server/guards";
import { handler, ok, readJson } from "@/lib/server/http";
import { getStyleGuide, updateStyleSummary } from "@/lib/server/style-guide";
import { styleSummarySchema } from "@/lib/validation/api";

/** GET /api/brand/style — the photo style guide's state and one-line summary (null before there is one). */
export const GET = handler(async () => {
  const { businessId } = await requireBusiness();
  return ok(await getStyleGuide(businessId));
});

/** PATCH /api/brand/style  { summary } — the owner's own line; it wins over the AI's from then on. */
export const PATCH = handler(async (request) => {
  const { businessId, session } = await requireBusiness();
  const { summary } = await readJson(request, styleSummarySchema);
  const guide = await updateStyleSummary(businessId, summary);
  await logActivity({ businessId, userId: session.userId, action: "brand.style_updated" });
  return ok(guide);
});
