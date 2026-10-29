// Shared types for all mock data. Everything in /mock is static demo content: nothing is fetched or sent.

export type Lang = "en" | "ar";
/** A piece of text in both languages. */
export type L = { en: string; ar: string };

export type AccountId = "mathanet" | "qahwa" | "tannour";

export type ConnectionStatus = "connected" | "reconnect" | "pending";

export interface Account {
  id: AccountId | string;
  handle: string;
  name: L;
  category: L;
  bio: L;
  link: string;
  avatar: string;
  followers: number;
  following: number;
  posts: number;
  connection: ConnectionStatus;
  location: L;
  hashtags: string[];
  /** Caption templates. `{dish}` is replaced with the photo's dish name. */
  captions: Record<CaptionTone, L>;
}

export type CaptionTone = "base" | "shorter" | "formal" | "friendly";

export type PhotoStatus = "published" | "scheduled" | "draft" | "none";
export type PhotoSource = "upload" | "instagram" | "ai";
export type PostType = "reel" | "carousel" | "photo";

export interface PostMetrics {
  likes: number;
  comments: number;
  reach: number;
  saves: number;
  shares: number;
  /** Reach per day for the first 7 days after publishing. */
  reachByDay: number[];
}

export interface Photo {
  id: string;
  accountId: string;
  src: string;
  thumb: string;
  dish: L;
  takenAt: string; // ISO
  status: PhotoStatus;
  source: PhotoSource;
  favorite: boolean;
  albums: string[];
  /** Category id (Sweets, Main dishes…): what the photo shows. The AI writes posts about this. */
  category?: string;
  /** A post the AI wrote, saved to the gallery (it shows in the AI Generated album). */
  aiPost?: boolean;
  /** AI-made images reuse a mock photo with a different look (1–3); see components/gallery/photo-image.tsx. */
  look?: number;
  scheduledFor?: string;
  publishedAt?: string;
  postType?: PostType;
  promoted?: boolean;
  metrics?: PostMetrics;
  caption?: L;
  credit: { author: string; link: string };
  /** A demo business's sample photo (shown with a "Sample" label); real businesses never get these. */
  sample?: boolean;
  /** The saved draft (PostDraft) this photo is in, with its hashtags, suggested time and earlier captions. */
  draftId?: string;
  hashtags?: string[];
  suggestedFor?: string;
  captionVersions?: { en: string; ar: string; at: string }[];
  /** A synced Instagram post: its link, and whether Instagram gave no reach/saves/shares for it. */
  permalink?: string;
  metricsPartial?: boolean;
}

export interface CustomAlbum {
  id: string;
  name: L;
  /** Set on category albums: photos moved in take this category. */
  category?: string;
}

export type EngagementKind = "comment" | "message";
export type SentAs = "as-is" | "edited" | "own";

export interface Customer {
  name: string;
  handle: string;
  /** Initials avatar tint (index into a fixed palette). */
  tint: number;
}

export interface EngagementItem {
  id: string;
  kind: EngagementKind;
  customer: Customer;
  text: string;
  at: string; // ISO
  photoId?: string;
  unread: boolean;
  aiReply: string;
  /** Alternatives cycled through by "Regenerate". */
  alternatives: string[];
  sent?: { text: string; as: SentAs; at: string };
}

export type RecStatus = "new" | "accepted" | "dismissed" | "done";

export interface Recommendation {
  id: string;
  title: L;
  why: L;
  basedOn: number;
  impact: L;
  status: RecStatus;
}

export interface Insights {
  followers: number;
  followersChange: number; // percent week-over-week
  reach: number;
  reachChange: number;
  engagementRate: number; // percent
  engagementChange: number; // percentage points
  reachByDay: number[]; // last 7 days, oldest first
  aiHealth: "good" | "attention";
  lastAnalysis: string; // ISO
  nextAnalysis: string; // ISO
  postsAnalyzed: number;
  /** 7 days (Sat..Fri) x 6 time slots, 0..100 activity. */
  bestTimes: number[][];
  contentTypes: { type: PostType; engagement: number; posts: number }[];
  promoted: { reach: number; engagement: number; posts: number };
  organic: { reach: number; engagement: number; posts: number };
  weekly: { range: L; bullets: L[]; score: number };
}

export interface Competitor {
  id: string;
  handle: string;
  name: L;
  avatar: string;
  followers: number;
  postsPerWeek: number;
  engagementRate: number;
  growth: number; // followers % last 30 days
  mix: { reel: number; carousel: number; photo: number };
  bestDays: L;
  bestTime: L;
  thumbs: string[];
  note: L;
  analyzing?: boolean;
}

export type NotificationKind = "comment" | "message" | "published" | "recommendation" | "report" | "competitor" | "scheduled";

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  text: L;
  at: string;
  read: boolean;
  photoId?: string;
  href: string;
}
