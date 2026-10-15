import "server-only";
import { db } from "@/lib/db";
import { formatOf, type AnalysisPost } from "@/lib/analysis/posts";
import { getInstagramService, type CompetitorProfile } from "@/lib/services/instagram";
import type { MediaDto } from "@/types";
import { getInstagramAccount } from "./instagram-account";

/**
 * The posts the analysis pages work on: the business's own (stored Instagram data via the
 * InstagramService, Meta or mock) and a competitor's (business discovery). Read-only.
 */

/** Recent own posts considered by the analysis pages. */
export const OWN_POSTS_LIMIT = 30;

export function mediaToPost(m: MediaDto): AnalysisPost {
  return {
    id: m.id,
    caption: m.caption,
    format: m.format ?? formatOf(m.mediaType === "video" ? "VIDEO" : "IMAGE"),
    postedAt: m.postedAt,
    likes: m.likes,
    comments: m.comments,
    // Instagram reports 0 for a metric it doesn't have yet: treat it as missing, never as a measured zero.
    reach: m.reach > 0 ? m.reach : null,
    saves: m.reach > 0 ? m.saves : null,
    shares: m.shares ?? null,
    views: m.views ?? null,
  };
}

export interface OwnPosts {
  connected: boolean;
  /** "demo" = mock connection (the app's sample data). */
  demo: boolean;
  followers: number | null;
  timeZone: string;
  handle: string;
  posts: AnalysisPost[];
  /** By post id, for the views (image, link). */
  media: Map<string, MediaDto>;
}

/** The business's recent posts, newest first (empty when Instagram isn't connected). */
export async function ownPosts(businessId: string, limit = OWN_POSTS_LIMIT): Promise<OwnPosts> {
  const [account, business] = await Promise.all([
    getInstagramAccount(businessId),
    db.business.findUniqueOrThrow({ where: { id: businessId }, select: { timezone: true, instagramHandle: true } }),
  ]);
  const base = { timeZone: business.timezone || "Asia/Kuwait", handle: account.username || business.instagramHandle || "", demo: account.provider === "mock" };
  if (!account.connected && account.provider === "mock") return { ...base, connected: false, followers: null, posts: [], media: new Map() };
  const ig = getInstagramService();
  const [media, profile] = await Promise.all([ig.getMedia(account, { limit }), ig.getProfile(account).catch(() => null)]);
  const sorted = [...media].sort((a, b) => b.postedAt.localeCompare(a.postedAt));
  return {
    ...base,
    connected: account.connected || media.length > 0,
    followers: profile?.followers ?? null,
    posts: sorted.map(mediaToPost),
    media: new Map(sorted.map((m) => [m.id, m])),
  };
}

/** A competitor's recent posts from business discovery (likes, comments, caption, format, time). */
export function competitorPosts(profile: CompetitorProfile): AnalysisPost[] {
  return profile.recentPosts
    .filter((p) => p.postedAt)
    .map((p) => ({
      id: p.id,
      caption: p.caption ?? "",
      format: p.format ?? "photo",
      postedAt: p.postedAt!,
      likes: p.likes,
      comments: p.comments,
      reach: null,
      saves: null,
      shares: null,
      views: null,
    }))
    .sort((a, b) => b.postedAt.localeCompare(a.postedAt));
}
