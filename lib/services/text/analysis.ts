import type { MetricComparison, AccountStats } from "../../analysis/posts";
import { METHODS, isMethod, type Method } from "../../analysis/methods";
import type { MetricVsAverage } from "../../analysis/post-performance";
import { TextGenerationError } from "./errors";
import { summaryUsesOnlyGivenNumbers } from "./report";

/**
 * AI explanations for the analysis pages: competitor tactics, post methods (classification)
 * and one post's performance. The numbers are computed in code (lib/analysis) and handed to
 * the model as a labelled data block; any number in an answer that isn't in that block
 * rejects the answer (it is then shown without AI text). Pure; tested in tests/gemini/analysis.test.ts.
 */

const parseJson = (answer: string, what: string): Record<string, unknown> => {
  try {
    const json = JSON.parse(answer.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
    if (json && typeof json === "object") return json as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new TextGenerationError("bad_output", `The model's ${what} wasn't valid JSON.`, 200);
};
const clean = (v: unknown, max = 600) => (typeof v === "string" ? v.replace(/\*\*/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "");
const cleanList = (v: unknown, max: number) => (Array.isArray(v) ? v.map((x) => clean(x, 300)).filter(Boolean).slice(0, max) : []);

function assertNumbers(texts: string[], data: string, what: string) {
  if (!texts.every((t) => summaryUsesOnlyGivenNumbers(t, data))) {
    throw new TextGenerationError("bad_output", `The model's ${what} quoted numbers that aren't in the data.`, 200);
  }
}

// ── Data blocks ─────────────────────────────────────────────────────────────────

const FORMAT_LABEL = { reel: "Reels", carousel: "carousels", photo: "photos", video: "videos" } as const;
const DAY_LABEL = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" } as const;
const PART_LABEL = { morning: "morning (06–12)", afternoon: "afternoon (12–17)", evening: "evening (17–22)", night: "night (22–06)" } as const;
const METRIC_LABEL: Record<MetricComparison["metric"], string> = {
  postsPerWeek: "Posts per week",
  engagementPct: "Engagement (likes + comments per post as % of followers)",
  avgInteractions: "Average likes + comments per post",
  reelShare: "Share of posts that are Reels (%)",
  hashtagsPerPost: "Hashtags per post",
};

/** The measured numbers about one account, as labelled lines. */
export function statsLines(label: string, s: AccountStats | null, followers: number | null): string[] {
  if (!s) return [`### ${label}`, "No posts available."];
  return [
    `### ${label}`,
    followers !== null ? `Followers: ${followers}` : null,
    `Posts analysed: ${s.posts} over ${s.spanDays} days (${s.postsPerWeek} per week)`,
    `Content mix: ${s.mix.map((m) => `${FORMAT_LABEL[m.format]} ${m.sharePct}% (${m.posts} posts, ${m.avgInteractions} likes+comments on average)`).join("; ")}`,
    `Average per post: ${s.avgLikes} likes, ${s.avgComments} comments, ${s.avgInteractions} likes+comments${s.engagementPct !== null ? `; engagement ${s.engagementPct}% of followers` : ""}${s.avgReach !== null ? `; reach ${s.avgReach} (${s.reachPosts} posts)` : ""}`,
    `Posting days: ${s.byWeekday.map((d) => `${DAY_LABEL[d.key]} ${d.posts} posts (${d.avgInteractions} avg)`).join("; ")}`,
    `Posting times (business timezone): ${s.byDayPart.map((d) => `${PART_LABEL[d.key]} ${d.posts} posts (${d.avgInteractions} avg)`).join("; ")}`,
    `Hashtags: ${s.hashtagsPerPost} per post on average${s.hashtags.length ? `; most used: ${s.hashtags.map((h) => `${h.tag} (${h.count})`).join(", ")}` : ""}`,
  ].filter((l): l is string => l !== null);
}

export interface CompetitorInsightInput {
  businessName: string;
  businessNameAr: string | null;
  handle: string;
  you: AccountStats | null;
  youFollowers: number | null;
  them: AccountStats;
  themFollowers: number;
  comparison: MetricComparison[];
  /** Weekly follower snapshots: change over the span, and weeks measured. */
  growth: { changePct: number | null; weeks: number };
  /** Rule-based guess of the competitor's methods (captions only). */
  methods: Array<{ method: Method; posts: number; avgInteractions: number }>;
  bestCaptions: string[];
}

export function competitorDataBlock(input: CompetitorInsightInput): string {
  const fmt = (n: number | null) => (n === null ? "n/a" : String(n));
  return [
    statsLines(`The business (${input.businessName})`, input.you, input.youFollowers).join("\n"),
    "",
    statsLines(`Competitor @${input.handle}`, input.them, input.themFollowers).join("\n"),
    input.growth.changePct !== null ? `Competitor follower change over ${input.growth.weeks} weekly snapshots: ${input.growth.changePct}%` : "Competitor follower history: not enough weekly snapshots yet.",
    `Competitor content types (estimated from captions): ${input.methods.map((m) => `${m.method.replace(/_/g, " ")} ${m.posts} posts (${m.avgInteractions} avg)`).join("; ") || "none"}`,
    `Competitor's best post captions: ${input.bestCaptions.map((c) => `"${c.replace(/\s+/g, " ").slice(0, 140)}"`).join(" | ") || "none"}`,
    "",
    "### Measured comparison (business vs competitor)",
    ...input.comparison.map((c) => `${METRIC_LABEL[c.metric]}: business ${fmt(c.you)}, competitor ${fmt(c.them)}${c.ahead ? ` → ${c.ahead === "same" ? "about the same" : c.ahead === "you" ? "business ahead" : "competitor ahead"}` : ""}`),
  ].join("\n");
}

export const COMPETITOR_INSIGHT_SCHEMA = {
  type: "OBJECT",
  properties: {
    tactics_en: { type: "STRING", description: "2–3 sentences: what this competitor does on Instagram, in plain English." },
    tactics_ar: { type: "STRING", description: "The same in Arabic." },
    they_better_en: { type: "ARRAY", items: { type: "STRING" }, description: "1–3 things the competitor does better (measured)." },
    they_better_ar: { type: "ARRAY", items: { type: "STRING" } },
    you_better_en: { type: "ARRAY", items: { type: "STRING" }, description: "1–3 things the business does better (measured)." },
    you_better_ar: { type: "ARRAY", items: { type: "STRING" } },
    ideas_en: { type: "ARRAY", items: { type: "STRING" }, description: "2–3 concrete ideas for the business to try." },
    ideas_ar: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["tactics_en", "tactics_ar", "they_better_en", "they_better_ar", "you_better_en", "you_better_ar", "ideas_en", "ideas_ar"],
};

export interface CompetitorInsightText {
  tactics: string;
  theyBetter: string[];
  youBetter: string[];
  ideas: string[];
}
export interface CompetitorInsight {
  en: CompetitorInsightText;
  ar: CompetitorInsightText;
}

export function parseCompetitorInsight(answer: string, data: string): CompetitorInsight {
  const json = parseJson(answer, "competitor analysis");
  const side = (lang: "en" | "ar"): CompetitorInsightText => ({
    tactics: clean(json[`tactics_${lang}`]),
    theyBetter: cleanList(json[`they_better_${lang}`], 3),
    youBetter: cleanList(json[`you_better_${lang}`], 3),
    ideas: cleanList(json[`ideas_${lang}`], 3),
  });
  const en = side("en");
  const ar = side("ar");
  if (!en.tactics || !ar.tactics || en.ideas.length < 2 || ar.ideas.length < 2) {
    throw new TextGenerationError("bad_output", "The model's competitor analysis was incomplete.", 200);
  }
  assertNumbers([en, ar].flatMap((s) => [s.tactics, ...s.theyBetter, ...s.youBetter, ...s.ideas]), data, "competitor analysis");
  return { en, ar };
}

// ── Classifying posts into methods ──────────────────────────────────────────────

export interface ClassifyPostInput {
  id: string;
  format: string;
  caption: string;
  mentions: string[];
}

export function classifyDataBlock(posts: ClassifyPostInput[]): string {
  return posts.map((p) => `- id ${p.id} | ${p.format} | mentions: ${p.mentions.length ? p.mentions.map((m) => `@${m}`).join(" ") : "none"} | caption: "${p.caption.replace(/\s+/g, " ").slice(0, 300)}"`).join("\n");
}

export const CLASSIFY_SCHEMA = {
  type: "OBJECT",
  properties: {
    posts: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { id: { type: "STRING" }, method: { type: "STRING", enum: [...METHODS] } },
        required: ["id", "method"],
      },
    },
  },
  required: ["posts"],
};

/** id → method for the ids we asked about; unknown ids and methods are dropped. */
export function parseClassification(answer: string, ids: string[]): Map<string, Method> {
  const json = parseJson(answer, "classification");
  const asked = new Set(ids);
  const result = new Map<string, Method>();
  for (const item of Array.isArray(json.posts) ? json.posts : []) {
    const { id, method } = (item ?? {}) as { id?: unknown; method?: unknown };
    if (typeof id === "string" && asked.has(id) && isMethod(method)) result.set(id, method);
  }
  if (!result.size) throw new TextGenerationError("bad_output", "The model classified none of the posts.", 200);
  return result;
}

// ── One post's performance ──────────────────────────────────────────────────────

const POST_METRIC_LABEL = { likes: "Likes", comments: "Comments", reach: "Reach", saves: "Saves", shares: "Shares", views: "Views" } as const;

export interface PostInsightInput {
  businessName: string;
  businessNameAr: string | null;
  format: string;
  postedAt: string;
  caption: string;
  method: string | null;
  promoted: boolean;
  vsAverage: MetricVsAverage[];
  /** Change over the snapshot days, by metric. */
  growth: Partial<Record<string, number>>;
  days: number;
}

export function postDataBlock(input: PostInsightInput): string {
  return [
    `Post: ${input.format}, posted ${input.postedAt.slice(0, 10)}${input.method ? `, type: ${input.method.replace(/_/g, " ")}` : ""}${input.promoted ? ", marked as promoted (paid)" : ""}`,
    `Caption: "${input.caption.replace(/\s+/g, " ").slice(0, 300)}"`,
    ...input.vsAverage.map(
      (m) => `${POST_METRIC_LABEL[m.metric]}: ${m.value}${m.average !== null ? `; account average ${m.average} over ${m.basedOn} posts${m.vsAveragePct !== null ? ` (${m.vsAveragePct > 0 ? "+" : ""}${m.vsAveragePct}%)` : ""}` : ""}`,
    ),
    input.days >= 2 ? `Change over the last ${input.days} daily snapshots: ${Object.entries(input.growth).map(([k, v]) => `${k} +${v}`).join(", ")}` : "No history yet (fewer than 2 daily snapshots).",
  ].join("\n");
}

export const POST_INSIGHT_SCHEMA = {
  type: "OBJECT",
  properties: {
    summary_en: { type: "STRING", description: "1–2 sentences: how the post performed vs the account's average." },
    summary_ar: { type: "STRING", description: "The same in Arabic." },
    learn_en: { type: "STRING", description: "One line: what to learn from it." },
    learn_ar: { type: "STRING", description: "The same in Arabic." },
  },
  required: ["summary_en", "summary_ar", "learn_en", "learn_ar"],
};

export interface PostInsight {
  en: { summary: string; learn: string };
  ar: { summary: string; learn: string };
}

export function parsePostInsight(answer: string, data: string): PostInsight {
  const json = parseJson(answer, "post explanation");
  const insight = {
    en: { summary: clean(json.summary_en, 400), learn: clean(json.learn_en, 240) },
    ar: { summary: clean(json.summary_ar, 400), learn: clean(json.learn_ar, 240) },
  };
  if (!insight.en.summary || !insight.ar.summary || !insight.en.learn || !insight.ar.learn) {
    throw new TextGenerationError("bad_output", "The model's post explanation was empty.", 200);
  }
  assertNumbers([insight.en.summary, insight.en.learn, insight.ar.summary, insight.ar.learn], data, "post explanation");
  return insight;
}

/** Bump when a prompt changes, so cached AI text is regenerated. */
export const ANALYSIS_PROMPT_VERSION = 1;
