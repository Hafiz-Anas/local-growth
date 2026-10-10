import { db } from "@/lib/db";
import { isFeatureEnabled } from "@/lib/permissions";
import { getBrandProfile } from "@/lib/server/brand";
import * as data from "@/lib/server/data";
import { requireRole } from "@/lib/server/guards";
import { handler, notFound, ok, readParams } from "@/lib/server/http";
import { getConnectionDto } from "@/lib/server/instagram-account";
import { getPermissionsDto } from "@/lib/server/permissions";
import { notificationPrefsSchema } from "@/lib/validation/api";
import type { PreviewDto } from "@/types";

/**
 * GET /api/admin/preview/:businessId — read-only snapshot of exactly what the
 * business's user sees: their enabled features and the data of those features.
 * Built from the same readers as the user API, with the same feature checks.
 */
export const GET = handler(async (_request, context: RouteContext<"/api/admin/preview/[businessId]">) => {
  await requireRole("ADMIN");
  const { businessId } = await readParams(context, "businessId");
  if (!(await db.business.count({ where: { id: businessId } }))) throw notFound("Business");

  const { permissions, enabled } = await getPermissionsDto(businessId);
  const owner = await db.user.findFirst({ where: { businessId, role: "USER" }, orderBy: { createdAt: "asc" }, select: { notificationPrefs: true } });
  const on = (key: Parameters<typeof isFeatureEnabled>[1]) => isFeatureEnabled(permissions, key);

  const preview: PreviewDto = {
    business: await data.getBusinessSummary(businessId),
    features: enabled,
    data: {
      dashboard: await data.getDashboard(businessId, permissions),
      instagram: await getConnectionDto(businessId),
      brand: await getBrandProfile(businessId),
      notifications: notificationPrefsSchema.catch(notificationPrefsSchema.parse({})).parse(owner?.notificationPrefs ?? {}),
    },
  };
  const d = preview.data;
  if (on("competitors.accounts")) d.competitors = await data.listCompetitors(businessId);
  if (on("competitors.trendingAudio") || on("competitors.trendingHashtags")) d.trends = await data.getTrends(businessId, permissions);
  if (on("postGenerator")) {
    d.generatorOptions = await data.getGeneratorOptions(businessId, permissions);
    d.drafts = await data.listDrafts(businessId);
  }
  if (on("experiment.scheduleQueue") || on("postGenerator.addToQueue")) d.scheduledPosts = await data.listScheduled(businessId);
  if (on("experiment")) d.experiment = await data.getExperiment(businessId, permissions);
  if (on("engagement")) d.engagement = await data.getEngagement(businessId, permissions);
  if (on("engagement.dmRules")) d.rules = await data.listRules(businessId);
  if (on("engagement.aiReplies")) d.replyDrafts = await data.listReplies(businessId);
  if (on("settings.brandVoice")) d.brandVoice = await data.getBrandVoice(businessId);
  return ok(preview);
});
