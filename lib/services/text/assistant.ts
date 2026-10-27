import type { MethodRank, PromotedComparison, Method } from "../../analysis/methods";
import type { MonitorOutcome, MonitorPoint } from "../../analysis/monitoring";
import type { StatisticsData } from "../../analysis/statistics";
import { statisticsDataBlock } from "./statistics";
import type { AccountStats, MetricComparison } from "../../analysis/posts";
import { statsLines } from "./analysis";
import { focusLines, type BusinessFocus } from "./focus";

/**
 * The AI data block (Recommendations, Weekly reports; once the old AI assistant's): what the server gathers about a business (its
 * stored Instagram data, brand profile and tracked competitors), the derived
 * numbers we compute in code so the model never has to (averages, best and
 * weakest posts), and the plain-text block the model is given. Only facts in
 * this block may appear in an answer. Pure (no server-only) so it can be unit-tested.
 */

export const ASSISTANT_MODES = ["post", "analytics", "competitors"] as const;
export type AssistantMode = (typeof ASSISTANT_MODES)[number];
/** Which sections the data block holds: an assistant mode, or "strategy" (everything, for recommendations). */
export type FactsScope = AssistantMode | "strategy";


export interface AssistantMetric {
  value: number;
  /** vs the previous 30 days, in percent. */
  changePct: number;
  /** False when Instagram has no data for it yet. */
  available: boolean;
}

export interface AssistantPost {
  postedAt: string;
  type: "image" | "video";
  caption: string;
  likes: number;
  comments: number;
  reach: number;
  saves: number;
}

export interface AssistantCompetitor {
  handle: string;
  name: string;
  followers: number;
  /** Percent. */
  engagementRate: number;
  /** Follower change over ~30 days, percent; null when we have no history yet. */
  followerChangePct: number | null;
  postsPerWeek: number;
  recentPosts: Array<{ likes: number; comments: number }>;
  lastFetchedAt: string | null;
  note: string | null;
}

export interface AssistantFacts {
  business: {
    name: string;
    nameAr: string | null;
    type: string | null;
    location: string;
    description: string | null;
    products: string[];
    targetAudience: string | null;
    languages: Array<"ar" | "en">;
    timezone: string;
    /** Niche, aim, goals, timeline and example caption (onboarding / Settings → Goals). */
    focus: BusinessFocus;
  };
  brand: {
    summary: string | null;
    captionStyle: string | null;
    postTypes: string[];
    toneLevel: number;
    wordsToUse: string[];
    wordsToAvoid: string[];
    hashtags: string[];
  };
  instagram: {
    /** "demo" = the app's sample data (mock connection), not the business's real account. */
    status: "connected" | "demo" | "reconnect_needed" | "not_connected";
    username: string | null;
    lastSyncAt: string | null;
  };
  /** Present only with Instagram data (connected, demo, or synced before a reconnect was needed). */
  profile?: { followers: number; following: number; posts: number };
  metrics?: { reach: AssistantMetric; engagementRate: AssistantMetric; followerGrowth: AssistantMetric; profileVisits: AssistantMetric };
  followers?: { first: { date: string; value: number }; last: { date: string; value: number }; days: number } | null;
  posts?: AssistantPost[];
  windows?: {
    baselineReach: number;
    list: Array<{ startHour: number; endHour: number; postsSampled: number; avgReach: number; vsBaselinePct: number }>;
    best: { startHour: number; endHour: number; liftPct: number; sampleSize: number; confidencePct: number } | null;
  };
  /** Only for the competitors mode, and only when the business has that feature. */
  competitors?: AssistantCompetitor[];
  /** The analysis pages' numbers (each part only with its feature): content mix, methods, competitor analysis. */
  analysis?: AssistantAnalysis;
  /** Strategy only, with "Most shared" on: share rates and the cached findings as labelled lines (shareabilityFactLines). */
  shareability?: string[];
}

export interface AssistantAnalysis {
  /** The business's own posts: formats, posting days/times, hashtags (lib/analysis/posts.ts). */
  you?: AccountStats | null;
  followers?: number | null;
  /** Analytics: marketing methods ranked by likes + comments, and promoted vs normal posts. */
  methods?: { ranking: MethodRank[]; promoted: PromotedComparison } | null;
  /** Analytics: posts being monitored (latest reading vs the account's average) and recently ended monitoring. */
  monitoring?: AssistantMonitoring | null;
  /** Analytics: account numbers over the last 30 days vs the 30 before (the Statistics page). */
  statistics?: { data: StatisticsData; demo: boolean } | null;
  /** Competitors: measured numbers per competitor, weekly growth, comparison and estimated content types. */
  competitors?: Array<{
    handle: string;
    followers: number;
    stats: AccountStats | null;
    growth: { changePct: number | null; weeks: number };
    comparison: MetricComparison[];
    methods: Array<{ method: Method; posts: number; avgInteractions: number }>;
    issue: string | null;
  }>;
}

export interface AssistantMonitoring {
  active: Array<{ caption: string; postedAt: string; duration: string; startedAt: string; endsAt: string; readings: number; first: MonitorPoint | null; latest: MonitorPoint | null; average: number | null; vsAveragePct: number | null }>;
  ended: Array<{ caption: string; postedAt: string; duration: string; endedAt: string; outcome: MonitorOutcome | null }>;
}

const caption = (text: string) => `"${text.replace(/\s+/g, " ").slice(0, 80)}"`;

/** Post monitoring as labelled lines (numbers only, from the readings). */
export function monitoringLines(m: AssistantMonitoring): string[] {
  if (!m.active.length && !m.ended.length) return [];
  const reading = (p: MonitorPoint) => `${p.likes} likes, ${p.comments} comments${p.reach !== null ? `, reach ${p.reach}` : ""}${p.saves !== null ? `, saves ${p.saves}` : ""}${p.shares !== null ? `, shares ${p.shares}` : ""}`;
  const lines = ["", "## Post monitoring (readings taken by the app while a post is monitored)"];
  for (const a of m.active) {
    lines.push(
      `Monitoring now: post from ${a.postedAt.slice(0, 10)} ${caption(a.caption)}, for ${a.duration} until ${a.endsAt.slice(0, 16).replace("T", " ")} UTC; ${a.readings} readings` +
        (a.first && a.latest && a.readings >= 2 ? `; first ${reading(a.first)}; latest ${reading(a.latest)}` : a.latest ? `; latest ${reading(a.latest)}` : "") +
        (a.vsAveragePct !== null && a.average !== null ? `; likes+comments ${a.vsAveragePct > 0 ? "+" : ""}${a.vsAveragePct}% vs the account average of ${a.average}` : ""),
    );
  }
  for (const e of m.ended) {
    const o = e.outcome;
    const gained = o ? Object.entries(o.gained).map(([k, v]) => `${k} ${v > 0 ? "+" : ""}${v}`).join(", ") : "";
    const vs = o?.vsAverage.interactions;
    lines.push(
      `Monitoring ended ${e.endedAt.slice(0, 10)}: post from ${e.postedAt.slice(0, 10)} ${caption(e.caption)} (${e.duration}); ${o?.readings ?? 0} readings` +
        (gained ? `; change while monitored: ${gained}` : "") +
        (vs ? `; final likes+comments ${vs.value} vs average ${vs.average} (${vs.pct > 0 ? "+" : ""}${vs.pct}%)` : ""),
    );
  }
  return lines;
}

const round = (n: number, digits = 1) => Math.round(n * 10 ** digits) / 10 ** digits;
const avg = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

export interface PostStats {
  count: number;
  avgLikes: number;
  avgComments: number;
  /** Null when Instagram reported no reach for any post. */
  avgReach: number | null;
  /** Average (likes + comments) / followers, percent; null without a follower count. */
  avgEngagementPct: number | null;
  best: AssistantPost[];
  weakest: AssistantPost[];
  /** Average interactions per post by type, with how many posts each average is based on. */
  byType: Array<{ type: "image" | "video"; posts: number; avgInteractions: number }>;
  /** Per weekday in the business's timezone (Mon first, only days with posts). */
  byWeekday: Array<{ day: string; posts: number; avgInteractions: number; avgReach: number | null }>;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "Thu" for a post time, in the business's timezone (UTC if the zone is unknown). */
export function weekdayOf(iso: string, timeZone: string): string {
  const date = new Date(iso);
  try {
    return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(date);
  }
}

/** Numbers derived in code, so the model quotes them instead of doing arithmetic. */
export function postStats(posts: AssistantPost[], followers: number | null, timeZone = "UTC"): PostStats | null {
  if (!posts.length) return null;
  const interactions = (p: AssistantPost) => p.likes + p.comments;
  const ranked = [...posts].sort((a, b) => interactions(b) - interactions(a));
  const withReach = posts.filter((p) => p.reach > 0);
  const byType = (["image", "video"] as const)
    .map((type) => {
      const group = posts.filter((p) => p.type === type);
      return { type, posts: group.length, avgInteractions: round(avg(group.map(interactions))) };
    })
    .filter((g) => g.posts > 0);
  const byWeekday = WEEKDAYS.map((day) => {
    const group = posts.filter((p) => weekdayOf(p.postedAt, timeZone) === day);
    const reached = group.filter((p) => p.reach > 0);
    return { day, posts: group.length, avgInteractions: round(avg(group.map(interactions))), avgReach: reached.length ? Math.round(avg(reached.map((p) => p.reach))) : null };
  }).filter((d) => d.posts > 0);
  return {
    count: posts.length,
    avgLikes: round(avg(posts.map((p) => p.likes))),
    avgComments: round(avg(posts.map((p) => p.comments))),
    avgReach: withReach.length ? Math.round(avg(withReach.map((p) => p.reach))) : null,
    avgEngagementPct: followers ? round((avg(posts.map(interactions)) / followers) * 100, 2) : null,
    best: ranked.slice(0, 3),
    weakest: posts.length > 3 ? ranked.slice(-3).reverse() : [],
    byType,
    byWeekday,
  };
}

const hour = (h: number) => `${String(h).padStart(2, "0")}:00`;
const day = (iso: string) => iso.slice(0, 10);
const list = (items: string[]) => (items.length ? items.join(", ") : "none");
const oneLine = (text: string, max = 160) => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line || "(no caption)";
};
const pct = (n: number) => `${n > 0 ? "+" : ""}${round(n)}%`;
const metric = (label: string, m: AssistantMetric, unit = "") =>
  m.available ? `${label}: ${m.value}${unit} (${pct(m.changePct)} vs the previous 30 days)` : `${label}: not available from Instagram yet`;
const postLine = (p: AssistantPost, timeZone: string) =>
  `${day(p.postedAt)} (${weekdayOf(p.postedAt, timeZone)}) ${p.type}: ${p.likes} likes, ${p.comments} comments${p.reach ? `, reach ${p.reach}` : ""}${p.saves ? `, ${p.saves} saves` : ""} — "${oneLine(p.caption, 120)}"`;

const STATUS_TEXT: Record<AssistantFacts["instagram"]["status"], string> = {
  connected: "connected; the numbers below are the business's own stored Instagram data",
  demo: "demo connection; the numbers below are the app's sample data for this demo business",
  reconnect_needed: "needs to be reconnected; the numbers below are from the last successful sync and may be out of date",
  not_connected: "not connected, so there is NO Instagram performance data",
};

/** Everything the model may use, as labelled plain text. Sections are absent when there's no data. */
export function formatFacts(facts: AssistantFacts, mode: FactsScope, now = new Date()): string {
  const b = facts.business;
  const ig = facts.instagram;
  const lines: string[] = [
    `Today: ${day(now.toISOString())} (business timezone ${b.timezone})`,
    "",
    "## Business",
    `Name: ${b.name}${b.nameAr ? ` (Arabic name: ${b.nameAr})` : ""}`,
    `Type: ${b.type ?? "not given"}; location: ${b.location || "not given"}`,
    b.description ? `Description: ${b.description}` : null,
    `Products: ${list(b.products)}`,
    b.targetAudience ? `Target audience: ${b.targetAudience}` : null,
    ...focusLines(b.focus),
    `Posting languages: ${b.languages.map((l) => (l === "ar" ? "Arabic" : "English")).join(" and ") || "not given"}`,
    "",
    "## Brand profile",
    facts.brand.summary ? `Summary: ${facts.brand.summary}` : "No confirmed brand profile yet.",
    facts.brand.captionStyle ? `Caption style: ${facts.brand.captionStyle}` : null,
    facts.brand.postTypes.length ? `Post types: ${facts.brand.postTypes.join(" | ")}` : null,
    `Words to use: ${list(facts.brand.wordsToUse)}; words to avoid: ${list(facts.brand.wordsToAvoid)}`,
    `Brand hashtags (the only ones a caption may use): ${list(facts.brand.hashtags)}`,
    "",
    "## Instagram",
    `Account: ${ig.username ? `@${ig.username}` : "none"} — ${STATUS_TEXT[ig.status]}${ig.lastSyncAt ? ` (last synced ${ig.lastSyncAt})` : ""}`,
  ].filter((l): l is string => l !== null);
  const push = (...more: Array<string | null>) => lines.push(...more.filter((l): l is string => l !== null));

  if (facts.profile) lines.push(`Profile: ${facts.profile.followers} followers, following ${facts.profile.following}, ${facts.profile.posts} posts`);
  if (facts.metrics && mode !== "post") {
    const m = facts.metrics;
    lines.push(
      "",
      "## Account metrics (last 30 days)",
      metric("Accounts reached", m.reach),
      metric("Engagement rate", m.engagementRate, "%"),
      metric("Net new followers", m.followerGrowth),
      metric("Profile visits", m.profileVisits),
    );
  }
  if (facts.followers && (mode === "analytics" || mode === "strategy")) {
    const f = facts.followers;
    lines.push(`Followers: ${f.first.value} on ${day(f.first.date)} → ${f.last.value} on ${day(f.last.date)} (${f.days} daily points)`);
  }

  const posts = facts.posts ?? [];
  const stats = postStats(posts, facts.profile?.followers ?? null, b.timezone);
  if (stats) {
    push(
      "",
      `## Recent posts (${stats.count}, newest first)`,
      `Averages per post: ${stats.avgLikes} likes, ${stats.avgComments} comments${stats.avgReach !== null ? `, reach ${stats.avgReach}` : ""}${stats.avgEngagementPct !== null ? `, engagement ${stats.avgEngagementPct}% of followers` : ""}`,
      `By type: ${stats.byType.map((g) => `${g.type} ${g.avgInteractions} likes+comments on average (${g.posts} post${g.posts === 1 ? "" : "s"})`).join("; ")}`,
      `Best by likes+comments: ${stats.best.map((p) => `${day(p.postedAt)} (${p.likes + p.comments})`).join(", ")}`,
      stats.weakest.length ? `Weakest by likes+comments: ${stats.weakest.map((p) => `${day(p.postedAt)} (${p.likes + p.comments})`).join(", ")}` : null,
      `By weekday (${b.timezone}): ${stats.byWeekday.map((d) => `${d.day} ${d.avgInteractions} likes+comments${d.avgReach !== null ? `, reach ${d.avgReach}` : ""} (${d.posts} post${d.posts === 1 ? "" : "s"})`).join("; ")}`,
      ...posts.slice(0, mode === "analytics" || mode === "strategy" ? 20 : 12).map((p) => postLine(p, b.timezone)),
    );
  } else if (ig.status !== "not_connected") {
    lines.push("", "## Recent posts", "No posts stored yet.");
  }

  if (facts.windows && mode !== "competitors") {
    const w = facts.windows;
    lines.push(
      "",
      `## Posting times (reach by the hour a post went out; baseline reach ${w.baselineReach})`,
      ...w.list.map((x) => `${hour(x.startHour)}–${hour(x.endHour)}: ${x.postsSampled} posts, average reach ${x.avgReach} (${pct(x.vsBaselinePct)} vs baseline)`),
      w.best
        ? `Strongest window: ${hour(w.best.startHour)}–${hour(w.best.endHour)}, ${pct(w.best.liftPct)} reach, based on ${w.best.sampleSize} posts, ${w.best.confidencePct}% confidence`
        : "No window stands out yet (too few posts).",
    );
  }

  if (mode === "competitors" || (mode === "strategy" && facts.competitors)) {
    const competitors = facts.competitors ?? [];
    lines.push("", `## Tracked competitors (${competitors.length})`);
    if (!competitors.length) lines.push("None. The business hasn't added any competitors that we could load.");
    for (const c of competitors) {
      const recent = c.recentPosts.length ? `${c.recentPosts.length} recent posts averaging ${round(avg(c.recentPosts.map((p) => p.likes)))} likes and ${round(avg(c.recentPosts.map((p) => p.comments)))} comments` : "no recent posts loaded";
      lines.push(
        `@${c.handle} (${c.name}): ${c.followers} followers${c.followerChangePct !== null ? ` (${pct(c.followerChangePct)} in ~30 days)` : ""}, engagement ${c.engagementRate}%, ${c.postsPerWeek} posts/week, ${recent}${c.lastFetchedAt ? `; data from ${day(c.lastFetchedAt)}` : ""}${c.note ? `; note: ${c.note}` : ""}`,
      );
    }
    lines.push("We have no prices, ads, audience or reach data for competitors.");
  }

  const analysis = facts.analysis;
  if (analysis && (mode === "analytics" || mode === "strategy")) {
    if (analysis.you) lines.push("", "## Content mix and posting habits (measured)", ...statsLines("The business", analysis.you, analysis.followers ?? null).slice(1));
    if (analysis.methods && analysis.methods.ranking.length) {
      const m = analysis.methods;
      lines.push(
        "",
        "## Marketing methods (likes + comments per post by type; correlation, not causation)",
        ...m.ranking.map((r) => `${r.method.replace(/_/g, " ")}: ${r.posts} posts, ${r.avgInteractions} likes+comments on average (${pct(r.vsAveragePct)} vs the account average)${r.avgReach !== null ? `, reach ${r.avgReach}` : ""}${r.enoughData ? "" : " — too few posts to rank"}`),
        m.promoted.promoted.posts
          ? `Promoted (marked by the owner) vs normal posts: ${m.promoted.promoted.posts} promoted averaging ${m.promoted.promoted.avgInteractions}, ${m.promoted.organic.posts} normal averaging ${m.promoted.organic.avgInteractions}${m.promoted.diffPct !== null ? ` (${pct(m.promoted.diffPct)})` : ""}${m.promoted.enoughData ? "" : " — too few posts to compare"}`
          : "No posts are marked as promoted.",
      );
    }
  }
  if (analysis?.statistics && (mode === "analytics" || mode === "strategy")) {
    lines.push("", "## Statistics: the last 30 days vs the 30 before (from stored daily follower counts and posts; correlation, not causation)", statisticsDataBlock(analysis.statistics.data, { demo: analysis.statistics.demo }));
  }
  if (analysis?.monitoring && (mode === "analytics" || mode === "strategy")) lines.push(...monitoringLines(analysis.monitoring));
  if (facts.shareability?.length && mode === "strategy") lines.push(...facts.shareability);
  if (analysis?.competitors && mode === "competitors") {
    lines.push("", "## Competitor analysis (measured from their public posts; content types are estimates from captions)");
    if (analysis.you) lines.push(...statsLines("The business", analysis.you, analysis.followers ?? null));
    for (const c of analysis.competitors) {
      if (c.issue) {
        lines.push(`### Competitor @${c.handle}`, `Couldn't be loaded at the last weekly check (${c.issue.replace(/_/g, " ")}).`);
        continue;
      }
      lines.push(...statsLines(`Competitor @${c.handle}`, c.stats, c.followers));
      lines.push(c.growth.changePct !== null ? `Follower change over ${c.growth.weeks} weekly snapshots: ${pct(c.growth.changePct)}` : "Follower history: not enough weekly snapshots yet.");
      if (c.methods.length) lines.push(`Content types (estimated): ${c.methods.map((m) => `${m.method.replace(/_/g, " ")} ${m.posts}`).join(", ")}`);
      const ahead = c.comparison.filter((x) => x.ahead === "you" || x.ahead === "them");
      if (ahead.length) lines.push(`Measured differences: ${ahead.map((x) => `${x.metric} business ${x.you} vs competitor ${x.them} (${x.ahead === "you" ? "business ahead" : "competitor ahead"})`).join("; ")}`);
    }
  }

  return lines.join("\n");
}

