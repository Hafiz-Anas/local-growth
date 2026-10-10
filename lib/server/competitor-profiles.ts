import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { getInstagramService, type CompetitorProfile, type InstagramAccount } from "@/lib/services/instagram";
import { changePct } from "@/lib/services/meta/mappers";
import { coolingDown } from "./meta-client";

/**
 * Competitor profiles for Meta-connected businesses: business discovery results
 * are cached on the Competitor row for 6 hours, and every refresh saves a
 * CompetitorSnapshot — follower change and the engagement chart come from that
 * real history. Mock businesses keep calling the mock directly.
 */

export const COMPETITOR_CACHE_MS = 6 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

/** Saves a fresh lookup: cache, the row's headline numbers and a snapshot. */
export async function recordCompetitorFetch(competitorId: string, profile: CompetitorProfile) {
  const now = new Date();
  await db.$transaction([
    db.competitor.update({
      where: { id: competitorId },
      data: {
        profileCache: profile as unknown as Prisma.InputJsonObject,
        lastFetchedAt: now,
        followers: profile.followers,
        engagementRate: profile.engagementRate,
        avatarUrl: profile.avatarUrl,
      },
    }),
    db.competitorSnapshot.create({
      data: { competitorId, followers: profile.followers, mediaCount: profile.mediaCount ?? profile.recentPosts.length, engagementRate: profile.engagementRate, takenAt: now },
    }),
  ]);
}

/** Follower change over ~30 days and weekly engagement (last 12 weeks) from snapshots. */
async function withHistory(competitorId: string, profile: CompetitorProfile): Promise<CompetitorProfile> {
  const snapshots = await db.competitorSnapshot.findMany({
    where: { competitorId, takenAt: { gte: new Date(Date.now() - 90 * DAY) } },
    orderBy: { takenAt: "asc" },
    select: { takenAt: true, followers: true, engagementRate: true },
  });
  if (!snapshots.length) return profile;
  const monthAgo = snapshots.find((s) => s.takenAt.getTime() >= Date.now() - 31 * DAY) ?? snapshots[0];
  const byWeek = new Map<string, number>();
  for (const s of snapshots) {
    const weekStart = new Date(s.takenAt);
    weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
    byWeek.set(weekStart.toISOString().slice(0, 10), s.engagementRate); // latest of the week wins
  }
  return {
    ...profile,
    followerChangePct: monthAgo === snapshots.at(-1) ? 0 : changePct(profile.followers, monthAgo.followers),
    engagementHistory: [...byWeek].slice(-12).map(([date, rate]) => ({ date, rate })),
  };
}

/**
 * The profile to show for a tracked competitor. Meta: cached (≤ 6 h) or looked
 * up again (cached + snapshot); when Meta can't answer, the last cached profile
 * is shown. Mock: straight from the mock.
 */
export async function competitorProfileFor(account: InstagramAccount, competitor: { id: string; handle: string }): Promise<CompetitorProfile | null> {
  const service = getInstagramService();
  if (account.provider !== "meta") return service.getCompetitorProfile(account, competitor.handle).catch(() => null);

  const row = await db.competitor.findUnique({ where: { id: competitor.id }, select: { profileCache: true, lastFetchedAt: true } });
  const cached = (row?.profileCache ?? null) as CompetitorProfile | null;
  const fresh = cached && row?.lastFetchedAt && Date.now() - row.lastFetchedAt.getTime() < COMPETITOR_CACHE_MS;
  if (fresh) return withHistory(competitor.id, cached);

  if (account.connected && !coolingDown(account.businessId)) {
    try {
      const lookup = await service.lookupBusinessAccount(account, competitor.handle);
      if (lookup.status === "ready" && lookup.profile) {
        await recordCompetitorFetch(competitor.id, lookup.profile);
        return withHistory(competitor.id, lookup.profile);
      }
    } catch {
      // Logged by the Graph client; fall back to the cached profile.
    }
  }
  return cached ? withHistory(competitor.id, cached) : null;
}
