import type { MonitorOutcome, MonitorPoint } from "../../analysis/monitoring";
import { parseReportSummary } from "./report";

/**
 * The data block for the AI's short summary when monitoring a post ends. Every number comes
 * from MonitorOutcome (computed in code); an answer quoting any other number is rejected and
 * the summary is shown as numbers only. Pure; tested in tests/gemini/monitoring.test.ts.
 */

export interface MonitorSummaryInput {
  format: string;
  postedAt: string;
  caption: string;
  /** "2h", "7d"… as chosen by the client. */
  duration: string;
  interval: "hourly" | "daily";
  demo: boolean;
  outcome: MonitorOutcome;
}

const at = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

function readingLine(label: string, p: MonitorPoint): string {
  const parts = [`${p.likes} likes`, `${p.comments} comments`, `${p.interactions} likes+comments`];
  if (p.reach !== null) parts.push(`reach ${p.reach}`);
  if (p.saves !== null) parts.push(`saves ${p.saves}`);
  if (p.shares !== null) parts.push(`shares ${p.shares}`);
  if (p.views !== null) parts.push(`views ${p.views}`);
  return `${label} (${at(p.at)}): ${parts.join(", ")}`;
}

export function monitorDataBlock(input: MonitorSummaryInput): string {
  const o = input.outcome;
  const lines = [
    `Post: ${input.format}, posted ${input.postedAt.slice(0, 10)}`,
    `Caption: "${input.caption.replace(/\s+/g, " ").slice(0, 300)}"`,
    `Monitored ${input.duration} (${input.interval} readings) from ${at(o.startedAt)} to ${at(o.endedAt)}: ${o.readings} readings`,
    input.demo ? "This is demo data, not the business's real Instagram numbers." : null,
    o.first ? readingLine("First reading", o.first) : "No readings were taken.",
    o.last && o.readings >= 2 ? readingLine("Last reading", o.last) : null,
    Object.keys(o.gained).length ? `Change during monitoring: ${Object.entries(o.gained).map(([k, v]) => `${k} ${signed(v)}`).join(", ")}` : "Change during monitoring: not enough readings to compare.",
    o.peak ? `Fastest growth: ${signed(o.peak.gained)} likes+comments between ${at(o.peak.from)} and ${at(o.peak.to)}` : null,
    o.baselinePosts > 0
      ? `Compared with the account's average over ${o.baselinePosts} other recent posts: ${
          Object.entries(o.vsAverage)
            .map(([k, v]) => `${k === "interactions" ? "likes+comments" : k} ${v.value} vs average ${v.average} (${signed(v.pct)}%)`)
            .join("; ") || "no comparable metric"
        }`
      : "No other posts to compare with.",
    o.baselinePosts > 0 && o.baselinePosts < 3 ? "The average is based on fewer than 3 posts: the comparison is early." : null,
  ];
  return lines.filter((l): l is string => l !== null).join("\n");
}

/** The model's JSON → { en, ar }; any number not in the data rejects the answer. */
export const parseMonitorSummary = (answer: string, data: string): { en: string; ar: string } => parseReportSummary(answer, data);

/** Bump when the prompt changes. */
export const MONITOR_PROMPT_VERSION = 1;
