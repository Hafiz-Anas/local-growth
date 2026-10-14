import type { ReportCompare, ReportPost, WeeklyNumbers } from "../../../types";
import type { AssistantPost } from "./assistant";
import { TextGenerationError } from "./errors";

/**
 * Weekly reports, the pure parts: the week's numbers vs the week before (all computed
 * here — the AI never calculates), the text the AI summarises, and a check that the
 * summary only quotes numbers from that text. Pure (no server-only) so it can be unit-tested.
 */

const DAY = 24 * 60 * 60 * 1000;
const round1 = (n: number) => Math.round(n * 10) / 10;
const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

export function compare(current: number | null, previous: number | null): ReportCompare {
  const changePct = current !== null && previous !== null && previous !== 0 ? round1(((current - previous) / previous) * 100) : null;
  return { current, previous, changePct };
}

/** The week ends at the start of the report day (UTC), so both weeks are complete days. */
export function reportPeriod(now: Date) {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return { start: end - 7 * DAY, end, previousStart: end - 14 * DAY };
}

/**
 * Net follower change over [from, to): the last daily value inside the period minus the last
 * value before it. Null when the series doesn't cover both.
 */
export function followerChange(series: Array<{ date: string; followers: number }>, from: number, to: number): number | null {
  const at = (t: number) => {
    const points = series.filter((p) => Date.parse(p.date) <= t);
    return points.length ? points[points.length - 1] : null;
  };
  const start = at(from - 1);
  const end = at(to - 1);
  if (!start || !end || start === end) return null;
  return end.followers - start.followers;
}

const toReportPost = (p: AssistantPost): ReportPost => ({ postedAt: p.postedAt, type: p.type, caption: p.caption.replace(/\s+/g, " ").trim().slice(0, 140), likes: p.likes, comments: p.comments, reach: p.reach });

export function computeWeeklyNumbers(input: {
  posts: AssistantPost[];
  followerSeries: Array<{ date: string; followers: number }>;
  followers: number | null;
  demo: boolean;
  now: Date;
}): WeeklyNumbers {
  const { start, end, previousStart } = reportPeriod(input.now);
  const inRange = (from: number, to: number) => input.posts.filter((p) => {
    const t = Date.parse(p.postedAt);
    return t >= from && t < to;
  });
  const week = inRange(start, end);
  const prev = inRange(previousStart, start);
  const interactions = (p: AssistantPost) => p.likes + p.comments;
  const reachOf = (posts: AssistantPost[]) => (posts.some((p) => p.reach > 0) ? posts.reduce((n, p) => n + p.reach, 0) : posts.length ? null : 0);
  const avgOf = (posts: AssistantPost[]) => {
    const m = mean(posts.map(interactions));
    return m === null ? null : round1(m);
  };
  const rate = (avg: number | null) => (avg !== null && input.followers ? Math.round((avg / input.followers) * 10000) / 100 : null);
  const ranked = [...week].sort((a, b) => interactions(b) - interactions(a));
  const weekAvg = avgOf(week);
  const prevAvg = avgOf(prev);

  return {
    periodStart: new Date(start).toISOString(),
    periodEnd: new Date(end).toISOString(),
    posts: compare(week.length, prev.length),
    reach: compare(reachOf(week), reachOf(prev)),
    avgInteractions: compare(weekAvg, prevAvg),
    engagementRate: compare(rate(weekAvg), rate(prevAvg)),
    followerChange: compare(followerChange(input.followerSeries, start, end), followerChange(input.followerSeries, previousStart, start)),
    followers: input.followers,
    top: ranked[0] ? toReportPost(ranked[0]) : null,
    weakest: ranked.length >= 2 ? toReportPost(ranked[ranked.length - 1]) : null,
    quality: { demo: input.demo, thin: week.length < 2 || prev.length < 2 },
  };
}

const value = (n: number | null, unit = "") => (n === null ? "no data" : `${n}${unit}`);
const change = (c: ReportCompare) => (c.changePct === null ? "" : ` (${c.changePct > 0 ? "+" : ""}${c.changePct}%)`);
const line = (label: string, c: ReportCompare, unit = "") => `${label}: ${value(c.current, unit)} this week vs ${value(c.previous, unit)} the week before${change(c)}`;
const postText = (p: ReportPost) => `${p.postedAt.slice(0, 10)} ${p.type}: ${p.likes} likes, ${p.comments} comments${p.reach ? `, reach ${p.reach}` : ""} — "${p.caption || "(no caption)"}"`;

/** The numbers as plain text: the only facts the summary may use. */
export function formatReportNumbers(n: WeeklyNumbers): string {
  return [
    `Week: ${n.periodStart.slice(0, 10)} to ${n.periodEnd.slice(0, 10)} (7 days), compared with the 7 days before.`,
    n.quality.demo ? "Data: the app's demo data, not the business's real account." : null,
    n.quality.thin ? "Data: fewer than 2 posts in at least one of the weeks, so changes are not meaningful." : null,
    line("Posts", n.posts),
    line("Total reach of the week's posts", n.reach),
    line("Average likes + comments per post", n.avgInteractions),
    line("Engagement rate (average likes + comments per post as % of followers)", n.engagementRate, "%"),
    line("Net new followers", n.followerChange),
    n.followers !== null ? `Followers now: ${n.followers}` : null,
    n.top ? `Top post: ${postText(n.top)}` : "Top post: none (no posts this week)",
    n.weakest ? `Weakest post: ${postText(n.weakest)}` : null,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");
}

const ARABIC_DIGITS = /[٠-٩]/g;
/** Every number in a text (Arabic-Indic digits and thousands separators normalised). */
export function numbersIn(text: string): number[] {
  const western = text.replace(ARABIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/٫/g, ".").replace(/(\d)[,٬](?=\d{3}\b)/g, "$1");
  return (western.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}

/**
 * True when every number in the summary appears in the data (exactly, or rounded to a whole
 * number or one decimal), or is a small count like "7 days".
 */
export function summaryUsesOnlyGivenNumbers(summary: string, data: string): boolean {
  const allowed = new Set<number>();
  for (const n of numbersIn(data)) {
    allowed.add(n);
    allowed.add(Math.round(n));
    allowed.add(round1(n));
  }
  return numbersIn(summary).every((n) => allowed.has(n) || (Number.isInteger(n) && n <= 14));
}

export const REPORT_SUMMARY_SCHEMA = {
  type: "OBJECT",
  properties: {
    summary_en: { type: "STRING", description: "2–4 short sentences in plain English." },
    summary_ar: { type: "STRING", description: "The same summary in Arabic." },
  },
  required: ["summary_en", "summary_ar"],
};

/** The model's JSON → both summaries; any number not in the data rejects the answer. */
export function parseReportSummary(answer: string, data: string): { en: string; ar: string } {
  let json: { summary_en?: unknown; summary_ar?: unknown } | null = null;
  try {
    json = JSON.parse(answer.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  } catch {
    throw new TextGenerationError("bad_output", "The model's report summary wasn't valid JSON.", 200);
  }
  const clean = (v: unknown) => (typeof v === "string" ? v.replace(/\*\*/g, "").trim().slice(0, 900) : "");
  const en = clean(json?.summary_en);
  const ar = clean(json?.summary_ar);
  if (!en || !ar) throw new TextGenerationError("bad_output", "The model's report summary was empty.", 200);
  if (!summaryUsesOnlyGivenNumbers(en, data) || !summaryUsesOnlyGivenNumbers(ar, data)) {
    throw new TextGenerationError("bad_output", "The model's report summary quoted numbers that aren't in the data.", 200);
  }
  return { en, ar };
}
