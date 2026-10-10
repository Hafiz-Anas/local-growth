import { db } from "@/lib/db";
import { logActivity } from "@/lib/server/activity";
import { getEngagement } from "@/lib/server/data";
import { assertFeature, requireFeature } from "@/lib/server/guards";
import { ApiError, handler, ok, readJson } from "@/lib/server/http";
import { getInstagramAccount } from "@/lib/server/instagram-account";
import { engagementSettingsSchema } from "@/lib/validation/api";

/**
 * PATCH /api/engagement/settings  { autoReply?, priceQuestionsToWhatsApp? }
 * Each field needs its own feature (engagement.autoReply / engagement.whatsappPricing).
 */
export const PATCH = handler(async (request) => {
  const { businessId, session, permissions } = await requireFeature("engagement");
  const patch = await readJson(request, engagementSettingsSchema);
  if (patch.autoReply !== undefined) assertFeature(permissions, "engagement.autoReply");
  // Auto-replies are posted to Instagram, so turning them on needs a working connection.
  if (patch.autoReply === true && !(await getInstagramAccount(businessId)).connected) {
    throw new ApiError(409, "instagram_not_connected", "Connect Instagram to turn on auto-reply.");
  }
  if (patch.priceQuestionsToWhatsApp !== undefined) assertFeature(permissions, "engagement.whatsappPricing");

  await db.brandVoice.upsert({ where: { businessId }, update: patch, create: { businessId, ...patch } });
  await logActivity({ businessId, userId: session.userId, action: "engagement.settings_updated", details: patch });
  return ok(await getEngagement(businessId, permissions));
});
