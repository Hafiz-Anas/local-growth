import type { MediaIcon } from "./dashboard";
import type { MediaTone } from "./client";

export interface CompetitorPost {
  id: string;
  tone: MediaTone;
  icon: MediaIcon;
  likes: number;
  comments: number;
  notable: boolean;
  /** Real image (Meta business discovery); mock posts use tone/icon artwork instead. */
  mediaUrl?: string | null;
  permalink?: string | null;
}

export interface Competitor {
  id: string;
  handle: string;
  name: string;
  location: string;
  avatarUrl: string | null;
  avatarTone: MediaTone;
  avatarInitials: string;
  verified: boolean;
  followers: number;
  followerChangePct: number;
  engagementRate: number;
  postsPerWeek: number;
  recentPosts: CompetitorPost[];
  /** Short description of the most notable recent post. */
  notableNote: string;
}

export interface TrendingAudio {
  id: string;
  title: string;
  artist: string;
  reelsCount: number;
  growthPct: number;
}

export interface TrendingTag {
  id: string;
  tag: string;
  kind: "hashtag" | "keyword";
  postsCount: number;
  growthPct: number;
}

export interface CompetitorInsightsData {
  competitors: Competitor[];
  trendingAudio: TrendingAudio[];
  trendingTags: TrendingTag[];
  updatedAt: string;
}
