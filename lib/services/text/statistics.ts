import { changePct, type PeriodTotals, type StatisticsData } from "../../analysis/statistics";
import { parseReportSummary } from "./report";

/**
 * The data block for the AI's short summary of a Statistics period, and the summary's parser:
 * every number comes from StatisticsData (computed in code); an answer quoting any other number
 * is rejected and the page shows the numbers and charts only. Pure; tested in tests/gemini/statistics.test.ts.
 */

const RANGE_LABEL = { "7d": "the last 7 days", "30d": "the last 30 days", "90d": "the last 90 days", "1y": "the last 12 months" } as const;
const DAY_LABEL = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" } as const;
const PART_LABEL = { morning: "morning (06–12)", afternoon: "afternoon (12–17)", evening: "evening (17–22)", night: "night (22–06)" } as const;
const FORMAT_LABEL = { reel: "Reels", carousel: "carousels", photo: "photos", video: "videos" } as const;
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

function totalsLine(label: string, t: PeriodTotals, previous: PeriodTotals | null): string {
  const vs = (now: number | null, before: number | null | undefined) => {
    const pct = changePct(now, before);
    return pct === null ? "" : ` (${signed(pct)}% vs the period before)`;
  };
  return [
    `${label}: ${t.posts} posts (${t.postsPerWeek} per week)${vs(t.postsPerWeek, previous?.postsPerWeek)}`,
    `average likes+comments per post ${t.avgInteractions}${vs(t.avgInteractions, previous?.avgInteractions)}`,
    t.avgReach !== null ? `average reach per post ${t.avgReach} (${t.reachPosts} posts)${vs(t.avgReach, previous?.avgReach)}` : "reach: not reported",
    t.engagementPct !== null ? `engagement ${t.engagementPct}% of followers per post${vs(t.engagementPct, previous?.engagementPct)}` : "engagement: not available",
  ].join("; ");
}

export function statisticsDataBlock(data: StatisticsData, { demo }: { demo: boolean }): string {
  const a = data.availability;
  const lines = [
    `Period: ${RANGE_LABEL[data.range]} (${data.from} to ${data.to})`,
    demo ? "This is demo data, not the business's real Instagram numbers." : null,
    a.complete ? null : `Data only covers part of the period: follower counts are stored from ${a.followersFrom ?? "no date yet"}, posts from ${a.postsFrom ?? "no date yet"}.`,
    data.followers
      ? `Followers: ${data.followers.start} → ${data.followers.end} (${signed(data.followers.change)}${data.followers.changePct !== null ? `, ${signed(data.followers.changePct)}%` : ""}) over ${data.followers.points} daily counts`
      : "Followers: no stored daily counts in this period.",
    totalsLine("This period", data.current, data.previous),
    data.previous ? totalsLine("The period before", data.previous, null) : "The period before: no posts to compare with.",
    data.bestDays.length ? `Posting days by average likes+comments: ${data.bestDays.map((d) => `${DAY_LABEL[d.key]} ${d.avgInteractions} (${d.posts} posts)`).join("; ")}` : null,
    data.bestTimes.length ? `Posting times (business timezone) by average likes+comments: ${data.bestTimes.map((d) => `${PART_LABEL[d.key]} ${d.avgInteractions} (${d.posts} posts)`).join("; ")}` : null,
    data.mix.length ? `Content mix: ${data.mix.map((m) => `${FORMAT_LABEL[m.format]} ${m.sharePct}% (${m.posts} posts, ${m.avgInteractions} likes+comments on average)`).join("; ")}` : null,
  ];
  return lines.filter((l): l is string => l !== null).join("\n");
}

export const parseStatisticsSummary = (answer: string, data: string): { en: string; ar: string } => parseReportSummary(answer, data);

/** Bump when the prompt changes, so cached summaries are rewritten. */
export const STATISTICS_PROMPT_VERSION = 1;
