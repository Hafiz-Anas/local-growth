/**
 * What a competitor's card shows when it's expanded (Competitors → Accounts, UX4): numbers computed
 * in code from stored data only — follower snapshots (CompetitorSnapshot) and the posts we already
 * have from their public profile — never estimated, never written by the AI. Every number carries
 * its period. Pure (no server imports) so it's tested on its own (tests/competitor-summary.test.ts).
 */

/** The card looks at the last 30 days. */
export const SUMMARY_WINDOW_DAYS = 30;
/** Fewer posts than this in the window: "not enough recent posts yet" instead of numbers. */
export const SUMMARY_MIN_POSTS = 3;
/** The shortest period a post number is given for (a few posts in two days isn't a weekly rate). */
export const SUMMARY_MIN_DAYS = 7;
/** Follower snapshots must be at least this many days apart to show a change. */
export const GROWTH_MIN_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export type SummaryFormat = "reel" | "photo" | "carousel" | "video";
const FORMATS: readonly SummaryFormat[] = ["reel", "photo", "carousel", "video"];

export interface SummaryPost {
  id: string;
  likes: number;
  comments: number;
  postedAt?: string;
  format?: SummaryFormat;
}

export interface FollowerGrowth {
  /** Percent change between the first and the last snapshot in the window, one decimal. */
  changePct: number;
  /** Followers gained (or lost). */
  change: number;
  /** Days between those two snapshots. */
  days: number;
}

/**
 * Follower change over the window from stored snapshots: the oldest snapshot inside the last
 * `windowDays` against the newest. Null with fewer than two snapshots, or when they're less than
 * GROWTH_MIN_DAYS apart (too short to say anything).
 */
export function followerGrowth(snapshots: Array<{ takenAt: Date | string; followers: number }>, now = Date.now(), windowDays = SUMMARY_WINDOW_DAYS): FollowerGrowth | null {
  const from = now - windowDays * DAY_MS;
  const inWindow = snapshots
    .map((s) => ({ t: new Date(s.takenAt).getTime(), followers: s.followers }))
    .filter((s) => Number.isFinite(s.t) && s.t >= from && s.t <= now)
    .sort((a, b) => a.t - b.t);
  if (inWindow.length < 2) return null;
  const first = inWindow[0];
  const last = inWindow[inWindow.length - 1];
  const days = Math.round((last.t - first.t) / DAY_MS);
  if (days < GROWTH_MIN_DAYS || first.followers <= 0) return null;
  return { changePct: Math.round(((last.followers - first.followers) / first.followers) * 1000) / 10, change: last.followers - first.followers, days };
}

export interface FormatShare {
  format: SummaryFormat;
  posts: number;
  /** Percent of the posts in the window, rounded (they add up to about 100). */
  sharePct: number;
}

export type Observation =
  /** "Their Reels get 2.1× the likes and comments of their photos." */
  | { kind: "formatLift"; best: SummaryFormat; other: SummaryFormat; ratio: number }
  /** "One recent post got 3.4× their usual likes and comments." */
  | { kind: "standout"; ratio: number }
  /** "Most of their posts are Reels (67%)." */
  | { kind: "mostly"; format: SummaryFormat; sharePct: number };

export interface CompetitorSummary {
  /** The period every post number covers: the window, or less when the posts we have don't reach back that far. */
  days: number;
  /** Posts in that period. */
  posts: number;
  /** False below SUMMARY_MIN_POSTS: the card says there isn't enough data instead of showing numbers. */
  enough: boolean;
  postsPerWeek: number | null;
  formats: FormatShare[];
  /** At most two, each measured from these posts. */
  observations: Observation[];
  /** Their best posts in the period by likes + comments, best first (up to 3). */
  top: string[];
}

const interactions = (p: SummaryPost) => p.likes + p.comments;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * Posting frequency, format mix, observations and top posts from the posts in the last `windowDays`.
 * Posts without a time are left out (we can't place them in the period). When the oldest post we have
 * is inside the window, the period is from that post to now (at least a week), so the rate isn't understated.
 */
export function competitorSummary(posts: SummaryPost[], now = Date.now(), windowDays = SUMMARY_WINDOW_DAYS): CompetitorSummary {
  const from = now - windowDays * DAY_MS;
  const timed = posts.map((p) => ({ ...p, t: p.postedAt ? Date.parse(p.postedAt) : NaN })).filter((p) => Number.isFinite(p.t) && p.t <= now);
  const recent = timed.filter((p) => p.t >= from);
  const reachesBack = timed.some((p) => p.t < from);
  const oldest = recent.length ? Math.min(...recent.map((p) => p.t)) : now;
  // No recent posts at all: the whole window. Otherwise from the oldest post we have, at least SUMMARY_MIN_DAYS.
  const days = reachesBack || !recent.length ? windowDays : Math.max(SUMMARY_MIN_DAYS, Math.min(windowDays, Math.ceil((now - oldest) / DAY_MS)));
  const enough = recent.length >= SUMMARY_MIN_POSTS;
  const top = [...recent].sort((a, b) => interactions(b) - interactions(a)).slice(0, 3).map((p) => p.id);
  if (!enough) return { days, posts: recent.length, enough, postsPerWeek: null, formats: [], observations: [], top };

  const formats = FORMATS.map((format) => {
    const n = recent.filter((p) => (p.format ?? "photo") === format).length;
    return { format, posts: n, sharePct: Math.round((n / recent.length) * 100) };
  }).filter((f) => f.posts > 0);

  const observations: Observation[] = [];
  // Format with the most likes + comments vs the weakest, each with at least 2 posts, when the gap is clear.
  const byFormat = formats
    .filter((f) => f.posts >= 2)
    .map((f) => ({ format: f.format, avg: avg(recent.filter((p) => (p.format ?? "photo") === f.format).map(interactions)) }))
    .sort((a, b) => b.avg - a.avg);
  if (byFormat.length >= 2) {
    const best = byFormat[0];
    const other = byFormat[byFormat.length - 1];
    const ratio = other.avg > 0 ? round1(best.avg / other.avg) : 0;
    if (ratio >= 1.5) observations.push({ kind: "formatLift", best: best.format, other: other.format, ratio });
  }
  // One post far above the rest (vs the average of the others), with at least 4 posts to compare.
  if (recent.length >= 4) {
    const sorted = [...recent].sort((a, b) => interactions(b) - interactions(a));
    const rest = avg(sorted.slice(1).map(interactions));
    const ratio = rest > 0 ? round1(interactions(sorted[0]) / rest) : 0;
    if (ratio >= 2.5) observations.push({ kind: "standout", ratio });
  }
  // A format that dominates what they post.
  const main = [...formats].sort((a, b) => b.sharePct - a.sharePct)[0];
  if (main && main.sharePct >= 60 && formats.length > 1) observations.push({ kind: "mostly", format: main.format, sharePct: main.sharePct });

  return { days, posts: recent.length, enough, postsPerWeek: round1((recent.length / days) * 7), formats, observations: observations.slice(0, 2), top };
}
