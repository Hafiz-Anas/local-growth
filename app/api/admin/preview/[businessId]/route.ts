import { SHOW_STATISTICS } from "@/config/insights";
import { db } from "@/lib/db";
import { isFeatureEnabled } from "@/lib/permissions";
import { getBrandProfile } from "@/lib/server/brand";
import * as data from "@/lib/server/data";
import { requireRole } from "@/lib/server/guards";
import { handler, notFound, ok, readParams } from "@/lib/server/http";
import { getConnectionDto } from "@/lib/server/instagram-account";
import { getPermissionsDto } from "@/lib/server/permissions";
import { replyKinds, replySummary } from "@/lib/server/replies";
import { competitorAnalysis } from "@/lib/server/competitor-analysis";
import { methodsOverview } from "@/lib/server/methods";
import { STAT_RANGES } from "@/lib/analysis/statistics";
import { monitorDetail, monitoringOverview } from "@/lib/server/monitoring";
import { getStatistics } from "@/lib/server/statistics";
import { postDetail, postPerformance } from "@/lib/server/post-performance";
import { getShareability } from "@/lib/server/shareability";
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
  const owner = await db.user.findFirst({ where: { role: "USER", memberships: { some: { businessId } } }, orderBy: { createdAt: "asc" }, select: { notificationPrefs: true } });
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
  if (on("engagement.aiReplies") || on("engagement.dmRules")) {
    const kinds = replyKinds(permissions);
    d.replyDrafts = await data.listReplies(businessId, "PENDING", kinds);
    d.sentReplies = await data.listReplies(businessId, "POSTED", kinds);
    d.replySummary = await replySummary(businessId, kinds);
  }
  if (on("competitors.analysis")) d.competitorAnalysis = await competitorAnalysis(businessId);
  if (on("methods")) d.methods = await methodsOverview(businessId, permissions);
  if (on("postInsights")) {
    d.postPerformance = await postPerformance(businessId);
    if (on("postInsights.shareability")) d.shareability = await getShareability(businessId);
    // The recent posts, plus "Most shared" ones that are older.
    const ids = [...new Set([...d.postPerformance.summary.posts.map((p) => p.id), ...(d.shareability?.mostShared.map((p) => p.id) ?? [])])];
    d.postDetails = Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await postDetail(businessId, id, { shareability: on("postInsights.shareability") })] as const)));
  }
  if (on("monitoring")) {
    d.monitoring = await monitoringOverview(businessId);
    const ids = [...d.monitoring.active, ...d.monitoring.history].map((m) => m.id);
    d.monitorDetails = Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await monitorDetail(businessId, id)] as const)));
  }
  if (SHOW_STATISTICS && on("statistics")) d.statistics = Object.fromEntries(await Promise.all(STAT_RANGES.map(async (r) => [r, await getStatistics(businessId, r)] as const)));
  if (on("settings.brandVoice")) d.brandVoice = await data.getBrandVoice(businessId);
  return ok(preview);
});
