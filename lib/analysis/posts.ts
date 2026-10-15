/**
 * Numbers about an Instagram account's posts, computed in code (never by the AI): posting
 * frequency, content mix, averages, best posts, posting days and times, hashtags — for the
 * business itself and for each competitor (business discovery data), and the comparison of
 * the two. Pure (no server imports) so tests cover it (tests/analysis.test.ts).
 *
 * "Interactions" = likes + comments (the numbers Instagram shows for every public post).
 * Reach, saves, shares and views exist only for the business's own posts, when Instagram
 * reports them; they are null otherwise and never estimated.
 */

export const POST_FORMATS = ["reel", "carousel", "photo", "video"] as const;
export type PostFormat = (typeof POST_FORMATS)[number];

export interface AnalysisPost {
  id: string;
  caption: string;
  format: PostFormat;
  /** ISO time. */
  postedAt: string;
  likes: number;
  comments: number;
  reach: number | null;
  saves: number | null;
  shares: number | null;
  views: number | null;
}

/** Instagram's media_type / media_product_type → our format. */
export function formatOf(mediaType: string | null | undefined, productType?: string | null): PostFormat {
  const type = (mediaType ?? "").toUpperCase();
  const product = (productType ?? "").toUpperCase();
  if (product === "REELS") return "reel";
  if (type === "CAROUSEL_ALBUM" || type === "CAROUSEL") return "carousel";
  if (type === "VIDEO" || type === "REEL" || type === "REELS") return product === "FEED" ? "video" : "reel";
  return "photo";
}

export const interactions = (p: Pick<AnalysisPost, "likes" | "comments">) => p.likes + p.comments;

const round = (n: number, digits = 1) => Math.round(n * 10 ** digits) / 10 ** digits;
const avg = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
const DAY_MS = 24 * 60 * 60 * 1000;

/** Monday-first weekdays, as returned in byWeekday. */
export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
/** Parts of the day (local time of the business): 6–12, 12–17, 17–22, 22–6. */
export const DAY_PARTS = ["morning", "afternoon", "evening", "night"] as const;
export type DayPart = (typeof DAY_PARTS)[number];

export function dayPartOf(hour: number): DayPart {
  if (hour >= 6 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

/** Weekday and hour of a post in a timezone (UTC when the zone is unknown). */
export function localWeekdayHour(iso: string, timeZone: string): { weekday: Weekday; hour: number } {
  const date = new Date(iso);
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(date);
  } catch {
    parts = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(date);
  }
  const weekday = (parts.find((p) => p.type === "weekday")?.value ?? "Mon").slice(0, 3).toLowerCase() as Weekday;
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  return { weekday, hour };
}

/** Hashtags in captions, most used first (case-insensitive, first spelling kept). */
export function hashtagCounts(captions: string[], max = 8): Array<{ tag: string; count: number }> {
  const counts = new Map<string, { tag: string; count: number; first: number }>();
  let order = 0;
  for (const caption of captions) {
    const seen = new Set<string>();
    for (const raw of caption.match(/#[\p{L}\p{N}_]+/gu) ?? []) {
      const key = raw.toLowerCase();
      if (seen.has(key)) continue; // count a tag once per post
      seen.add(key);
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { tag: raw, count: 1, first: order++ });
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.first - b.first)
    .slice(0, max)
    .map(({ tag, count }) => ({ tag, count }));
}

export interface FormatShare {
  format: PostFormat;
  posts: number;
  /** Percent of the posts, rounded. */
  sharePct: number;
  avgInteractions: number;
}

export interface GroupStat<K extends string> {
  key: K;
  posts: number;
  avgInteractions: number;
}

export interface AccountStats {
  /** How many posts every number below is based on. */
  posts: number;
  /** Days between the oldest and newest post analysed (at least 1). */
  spanDays: number;
  postsPerWeek: number;
  mix: FormatShare[];
  avgLikes: number;
  avgComments: number;
  avgInteractions: number;
  /** Average interactions per post as a percent of followers; null without followers. */
  engagementPct: number | null;
  /** Own posts only: average reach of the posts that have it, and how many do. */
  avgReach: number | null;
  reachPosts: number;
  /** Top posts by interactions (ids), best first. */
  best: string[];
  byWeekday: Array<GroupStat<Weekday>>;
  byDayPart: Array<GroupStat<DayPart>>;
  /** The weekday / part of day with the most posts (ties: the higher average). */
  usualDay: Weekday | null;
  usualTime: DayPart | null;
  hashtags: Array<{ tag: string; count: number }>;
  /** Average hashtags per post. */
  hashtagsPerPost: number;
}

function groupBy<K extends string>(posts: AnalysisPost[], keys: readonly K[], keyOf: (p: AnalysisPost) => K): Array<GroupStat<K>> {
  return keys
    .map((key) => {
      const group = posts.filter((p) => keyOf(p) === key);
      return { key, posts: group.length, avgInteractions: round(avg(group.map(interactions))) };
    })
    .filter((g) => g.posts > 0);
}

const mostUsed = <K extends string>(groups: Array<GroupStat<K>>): K | null =>
  groups.length ? [...groups].sort((a, b) => b.posts - a.posts || b.avgInteractions - a.avgInteractions)[0].key : null;

/** Everything we measure about a set of posts. Null when there are no posts. */
export function accountStats(posts: AnalysisPost[], followers: number | null, timeZone: string, now = Date.now()): AccountStats | null {
  if (!posts.length) return null;
  const times = posts.map((p) => Date.parse(p.postedAt)).filter(Number.isFinite);
  const oldest = Math.min(...times);
  const spanDays = Math.max(1, Math.round((now - oldest) / DAY_MS));
  const local = new Map(posts.map((p) => [p.id, localWeekdayHour(p.postedAt, timeZone)]));
  const byWeekday = groupBy(posts, WEEKDAYS, (p) => local.get(p.id)!.weekday);
  const byDayPart = groupBy(posts, DAY_PARTS, (p) => dayPartOf(local.get(p.id)!.hour));
  const withReach = posts.filter((p) => p.reach !== null && p.reach > 0);
  const avgInteractions = round(avg(posts.map(interactions)));
  return {
    posts: posts.length,
    spanDays,
    postsPerWeek: round((posts.length / spanDays) * 7),
    mix: POST_FORMATS.map((format) => {
      const group = posts.filter((p) => p.format === format);
      return { format, posts: group.length, sharePct: Math.round((group.length / posts.length) * 100), avgInteractions: round(avg(group.map(interactions))) };
    }).filter((m) => m.posts > 0),
    avgLikes: round(avg(posts.map((p) => p.likes))),
    avgComments: round(avg(posts.map((p) => p.comments))),
    avgInteractions,
    engagementPct: followers && followers > 0 ? round((avgInteractions / followers) * 100, 2) : null,
    avgReach: withReach.length ? Math.round(avg(withReach.map((p) => p.reach!))) : null,
    reachPosts: withReach.length,
    best: [...posts].sort((a, b) => interactions(b) - interactions(a)).slice(0, 3).map((p) => p.id),
    byWeekday,
    byDayPart,
    usualDay: mostUsed(byWeekday),
    usualTime: mostUsed(byDayPart),
    hashtags: hashtagCounts(posts.map((p) => p.caption)),
    hashtagsPerPost: round(avg(posts.map((p) => (p.caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).length))),
  };
}

// ── You vs a competitor ─────────────────────────────────────────────────────────

export type ComparedMetric = "postsPerWeek" | "engagementPct" | "avgInteractions" | "reelShare" | "hashtagsPerPost";

export interface MetricComparison {
  metric: ComparedMetric;
  you: number | null;
  them: number | null;
  /** Who is ahead on this measured number ("same" within 10%); null when either side has no value. */
  ahead: "you" | "them" | "same" | null;
}

const reelShare = (s: AccountStats) => s.mix.find((m) => m.format === "reel")?.sharePct ?? 0;

/**
 * Measured differences only. Raw interactions favour bigger accounts, so engagement % (per
 * follower) is the fairer comparison; both are listed. Hashtags per post is shown without a winner.
 */
export function compareAccounts(you: AccountStats | null, them: AccountStats | null): MetricComparison[] {
  const pick = (s: AccountStats | null, m: ComparedMetric): number | null => {
    if (!s) return null;
    if (m === "reelShare") return reelShare(s);
    return s[m];
  };
  return (["postsPerWeek", "engagementPct", "avgInteractions", "reelShare", "hashtagsPerPost"] as const).map((metric) => {
    const a = pick(you, metric);
    const b = pick(them, metric);
    let ahead: MetricComparison["ahead"] = null;
    if (a !== null && b !== null && metric !== "hashtagsPerPost") {
      const top = Math.max(Math.abs(a), Math.abs(b));
      ahead = top === 0 || Math.abs(a - b) / top < 0.1 ? "same" : a > b ? "you" : "them";
    }
    return { metric, you: a, them: b, ahead };
  });
}

// ── Growth from snapshots ───────────────────────────────────────────────────────

export interface GrowthPoint {
  /** YYYY-MM-DD */
  date: string;
  followers: number;
  engagementPct: number;
}

/** One point per ISO week (the latest snapshot of the week), oldest first, and the follower change over the span. */
export function weeklyGrowth(snapshots: Array<{ takenAt: Date | string; followers: number; engagementRate: number }>): { points: GrowthPoint[]; changePct: number | null; weeks: number } {
  const byWeek = new Map<string, GrowthPoint>();
  for (const s of [...snapshots].sort((a, b) => new Date(a.takenAt).getTime() - new Date(b.takenAt).getTime())) {
    const d = new Date(s.takenAt);
    const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)));
    byWeek.set(monday.toISOString().slice(0, 10), { date: d.toISOString().slice(0, 10), followers: s.followers, engagementPct: s.engagementRate });
  }
  const points = [...byWeek.values()];
  const first = points[0];
  const last = points.at(-1);
  const changePct = points.length >= 2 && first.followers > 0 ? round(((last!.followers - first.followers) / first.followers) * 100) : null;
  return { points, changePct, weeks: points.length };
}

/** Stable short fingerprint of a value (for "has the data changed since the last AI analysis?"). */
export function fingerprint(value: unknown): string {
  const text = JSON.stringify(value);
  let h1 = 0x811c9dc5;
  let h2 = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = (h2 * 31 + c) >>> 0;
  }
  return `${h1.toString(36)}${h2.toString(36)}${text.length.toString(36)}`;
}
