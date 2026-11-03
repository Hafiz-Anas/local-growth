import "server-only";
import { db } from "@/lib/db";
import { computeOverview, type OverviewGoal } from "@/lib/analysis/overview";
import { readTargets } from "@/lib/onboarding-answers";
import { getInstagramService } from "@/lib/services/instagram";
import type { InsightsOverviewDto } from "@/types";
import { getInstagramAccount } from "./instagram-account";
import { ownPosts } from "./post-data";

/**
 * Insights → Overview (UX3): the last 7 days vs the 7 before, from what the app already stores —
 * the synced posts and the daily follower counts (InstagramService reads them from the database for
 * Meta accounts, so this makes no new Meta calls). The numbers and the summary are computed in code
 * (lib/analysis/overview.ts); the tips come from Recommendations on the page itself.
 */

/** Two weeks of posts, with room for busy accounts. */
const POSTS = 60;

export async function insightsOverview(businessId: string, now = Date.now()): Promise<InsightsOverviewDto> {
  const [own, business] = await Promise.all([ownPosts(businessId, POSTS), db.business.findUniqueOrThrow({ where: { id: businessId }, select: { targets: true, aim: true } })]);
  // The first target picked in onboarding, else the older single "main aim".
  const goal = (readTargets(business.targets)[0]?.key ?? business.aim ?? null) as OverviewGoal;
  let followerSeries: Array<{ date: string; followers: number }> = [];
  if (own.connected) {
    const account = await getInstagramAccount(businessId);
    followerSeries = (await getInstagramService().getInsights(account).catch(() => null))?.followerSeries ?? [];
  }
  const overview = computeOverview({ posts: own.connected ? own.posts : [], followerSeries, goal, now });
  return { ...overview, connected: own.connected, demo: own.demo };
}
