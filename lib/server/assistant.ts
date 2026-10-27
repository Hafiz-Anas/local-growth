import "server-only";
import { accountStats } from "@/lib/analysis/posts";
import { db } from "@/lib/db";
import { isFeatureEnabled } from "@/lib/permissions";
import { getInstagramService } from "@/lib/services/instagram";
import type { AssistantFacts, FactsScope } from "@/lib/services/text/assistant";
import type { Permissions } from "@/types";
import { currentBrandContext, postingLanguages } from "./brand";
import { FOCUS_SELECT, toBusinessFocus } from "./business-focus";
import { competitorAnalysis } from "./competitor-analysis";
import { listCompetitors } from "./data";
import { getInstagramAccount, needsReconnect } from "./instagram-account";
import { methodsOverview } from "./methods";
import { monitoringFacts } from "./monitoring";
import { statisticsFacts } from "./statistics";
import { ownPosts } from "./post-data";

/**
 * The data block behind Recommendations and Weekly reports: the business's stored Instagram data,
 * brand profile and tracked competitors (formatted by lib/services/text/assistant.ts). It was the old
 * AI assistant's grounding data; the chat itself is gone (the AI tab is front-end only for now).
 */

// ─── Grounding data ──────────────────────────────────────────────────────────

/**
 * Everything an answer may use. Instagram sections are left out when there's no data to show.
 * Competitors are loaded for the competitors mode, and for "strategy" when `withCompetitors`
 * (the business has the competitors feature). Shared by the recommendations and the weekly reports.
 */
export async function gatherAssistantFacts(businessId: string, mode: FactsScope, { withCompetitors = false, permissions }: { withCompetitors?: boolean; permissions?: Permissions } = {}): Promise<AssistantFacts> {
  const business = await db.business.findUniqueOrThrow({
    where: { id: businessId },
    select: {
      ...FOCUS_SELECT,
      name: true,
      nameAr: true,
      businessType: true,
      businessTypeOther: true,
      category: true,
      location: true,
      description: true,
      products: true,
      targetAudience: true,
      niche: true,
      aim: true,
      goals: true,
      timeline: true,
      exampleCaption: true,
      languages: true,
      timezone: true,
      brandVoice: { select: { toneLevel: true, brandWords: true, defaultHashtags: true, wordsToAvoid: true } },
      instagramConnection: { select: { provider: true, status: true, tokenExpiresAt: true, lastSyncAt: true, username: true } },
    },
  });
  const context = await currentBrandContext(businessId);
  const voice = business.brandVoice;
  const conn = business.instagramConnection;
  const account = await getInstagramAccount(businessId);

  const status: AssistantFacts["instagram"]["status"] =
    !conn || conn.status === "DISCONNECTED"
      ? "not_connected"
      : conn.provider === "META"
        ? needsReconnect(conn)
          ? "reconnect_needed"
          : "connected"
        : account.connected
          ? "demo"
          : "not_connected";

  const facts: AssistantFacts = {
    business: {
      name: business.name,
      nameAr: business.nameAr,
      type: business.businessType === "other" ? business.businessTypeOther : (business.businessType ?? business.category),
      location: business.location,
      description: business.description,
      products: business.products,
      targetAudience: business.targetAudience,
      focus: toBusinessFocus(business, { withProducts: false }),
      languages: postingLanguages(business.languages),
      timezone: business.timezone,
    },
    brand: {
      summary: context?.summary ?? null,
      captionStyle: context ? `${context.captionStyle.summary}${context.captionStyle.traits.length ? ` (${context.captionStyle.traits.join("; ")})` : ""}` : null,
      postTypes: context?.purposePatterns.map((p) => `${p.label ?? p.purpose}: ${p.description}`) ?? [],
      toneLevel: context?.toneLevel ?? voice?.toneLevel ?? 50,
      wordsToUse: context?.wordsToUse ?? voice?.brandWords ?? [],
      wordsToAvoid: context?.wordsToAvoid ?? voice?.wordsToAvoid ?? [],
      hashtags: [...new Set([...(context?.captionStyle.hashtags ?? []), ...(voice?.defaultHashtags ?? [])])],
    },
    instagram: { status, username: conn?.username ?? (account.username || null), lastSyncAt: conn?.provider === "META" ? (conn.lastSyncAt?.toISOString() ?? null) : null },
  };

  if (status !== "not_connected") {
    try {
      const ig = getInstagramService();
      const [profile, insights, media] = await Promise.all([ig.getProfile(account), ig.getInsights(account), ig.getMedia(account, { limit: 20 })]);
      const metric = (m: { value: number; changePct: number; available?: boolean }) => ({ value: m.value, changePct: m.changePct, available: m.available !== false });
      facts.profile = { followers: profile.followers, following: profile.following, posts: profile.posts };
      facts.metrics = {
        reach: metric(insights.metrics.reach),
        engagementRate: metric(insights.metrics.engagementRate),
        followerGrowth: metric(insights.metrics.followerGrowth),
        profileVisits: metric(insights.metrics.profileVisits),
      };
      const series = insights.followerSeries;
      facts.followers = series.length >= 2 ? { first: { date: series[0].date, value: series[0].followers }, last: { date: series.at(-1)!.date, value: series.at(-1)!.followers }, days: series.length } : null;
      // getMedia puts the top post first; the assistant wants plain newest-first order.
      facts.posts = [...media]
        .sort((a, b) => b.postedAt.localeCompare(a.postedAt))
        .map((m) => ({ postedAt: m.postedAt, type: m.mediaType, caption: m.caption, likes: m.likes, comments: m.comments, reach: m.reach, saves: m.saves }));
      const best = insights.opportunity && insights.windows.find((w) => w.id === insights.opportunity!.window);
      facts.windows = {
        baselineReach: insights.baselineReach,
        list: insights.windows.filter((w) => w.postsSampled > 0).map((w) => ({ startHour: w.startHour, endHour: w.endHour, postsSampled: w.postsSampled, avgReach: w.avgReach, vsBaselinePct: w.vsBaselinePct })),
        best: best && insights.opportunity ? { startHour: best.startHour, endHour: best.endHour, liftPct: insights.opportunity.liftPct, sampleSize: insights.opportunity.sampleSize, confidencePct: insights.opportunity.confidencePct } : null,
      };
    } catch (error) {
      // No numbers are better than wrong ones: answer from the brand data and say the Instagram data couldn't be read.
      console.error("[assistant] Instagram data unavailable", (error as Error).message);
      facts.instagram.status = "not_connected";
    }
  }

  if (mode === "competitors" || (mode === "strategy" && withCompetitors)) {
    try {
      facts.competitors = (await listCompetitors(businessId)).map((c) => ({
        handle: c.handle,
        name: c.displayName ?? c.name,
        followers: c.followers,
        engagementRate: c.engagementRate,
        followerChangePct: c.engagementHistory.length >= 2 ? c.followerChangePct : null,
        postsPerWeek: c.postsPerWeek,
        recentPosts: c.recentPosts.map((p) => ({ likes: p.likes, comments: p.comments })),
        lastFetchedAt: c.lastFetchedAt,
        note: c.note || c.notableNote || null,
      }));
    } catch (error) {
      console.error("[assistant] competitor data unavailable", (error as Error).message);
      facts.competitors = [];
    }
  }
  if (permissions && facts.instagram.status !== "not_connected") facts.analysis = await gatherAnalysis(businessId, mode, permissions);
  return facts;
}

/** The analysis pages' numbers for the chat (Analytics: content mix + methods; Competitors: competitor analysis). Never calls the AI. */
async function gatherAnalysis(businessId: string, mode: FactsScope, permissions: Permissions): Promise<AssistantFacts["analysis"]> {
  try {
    if (mode === "analytics") {
      const own = await ownPosts(businessId);
      const methods = isFeatureEnabled(permissions, "methods") ? await methodsOverview(businessId, permissions) : null;
      const monitoring = isFeatureEnabled(permissions, "monitoring") ? await monitoringFacts(businessId) : null;
      const statistics = isFeatureEnabled(permissions, "statistics") ? await statisticsFacts(businessId) : null;
      return {
        statistics, you: accountStats(own.posts, own.followers, own.timeZone), followers: own.followers, methods: methods && { ranking: methods.ranking, promoted: methods.promoted }, monitoring };
    }
    if (mode === "competitors" && isFeatureEnabled(permissions, "competitors.analysis")) {
      const a = await competitorAnalysis(businessId);
      return {
        you: a.you.stats,
        followers: a.you.followers,
        competitors: a.competitors.map((c) => ({ handle: c.handle, followers: c.followers, stats: c.stats, growth: { changePct: c.growth.changePct, weeks: c.growth.weeks }, comparison: c.comparison, methods: c.methods, issue: c.issue })),
      };
    }
  } catch (error) {
    console.error("[assistant] analysis data unavailable", (error as Error).message);
  }
  return undefined;
}
