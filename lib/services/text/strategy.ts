import { createHash } from "node:crypto";
import type { AssistantFacts, AssistantPost } from "./assistant";
import { TextGenerationError } from "./errors";

/**
 * AI strategy recommendations, the pure parts: the answer's schema and parsing
 * (with confidence capped by how many posts a pattern rests on), the cache
 * hash, and the before/after comparison for recommendations marked Done.
 * Pure (no server-only) so it can be unit-tested.
 */

/** Bump when the prompt or the schema changes, so cached results are re-analysed. */
export const STRATEGY_PROMPT_VERSION = 2;
export const STRATEGY_MIN = 3;
export const STRATEGY_MAX = 5;
/** Days between a recommendation marked Done and its outcome check. */
export const OUTCOME_DAYS = 7;
/** Days of posts before "Done" that make the baseline. */
export const BASELINE_DAYS = 14;

export const STRATEGY_CATEGORIES = ["content", "timing", "format", "engagement", "hashtags", "competitors", "shares"] as const;
export const STRATEGY_METRICS = ["reach", "interactions", "followers"] as const;
export const STRATEGY_CONFIDENCE = ["strong", "moderate", "early"] as const;
export type StrategyCategory = (typeof STRATEGY_CATEGORIES)[number];
export type StrategyMetric = (typeof STRATEGY_METRICS)[number];
export type StrategyConfidence = (typeof STRATEGY_CONFIDENCE)[number];

export interface StrategyRecommendation {
  actionEn: string;
  actionAr: string;
  rationaleEn: string;
  rationaleAr: string;
  category: StrategyCategory;
  metric: StrategyMetric;
  confidence: StrategyConfidence;
  basedOnPosts: number;
}

/** A past recommendation and what the owner did with it (fed into the next analysis). */
export interface StrategyDecision {
  status: "accepted" | "dismissed" | "done";
  /** ISO date of the decision. */
  at: string;
  action: string;
  /** For Done ones that have been measured. */
  outcome?: string | null;
}

export const STRATEGY_SCHEMA = {
  type: "OBJECT",
  properties: {
    recommendations: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          action_en: { type: "STRING", description: "One concrete action, imperative, under 90 characters." },
          action_ar: { type: "STRING", description: "The same action in Arabic." },
          rationale_en: { type: "STRING", description: "2–3 sentences citing the exact numbers from the data, how many posts it rests on, and that it is a pattern, not proof." },
          rationale_ar: { type: "STRING", description: "The same rationale in Arabic." },
          category: { type: "STRING", enum: [...STRATEGY_CATEGORIES] },
          metric: { type: "STRING", enum: [...STRATEGY_METRICS], description: "The metric that should move if the action works." },
          confidence: { type: "STRING", enum: [...STRATEGY_CONFIDENCE] },
          based_on_posts: { type: "INTEGER", description: "How many of the business's posts the pattern is based on (0 if none)." },
        },
        required: ["action_en", "action_ar", "rationale_en", "rationale_ar", "category", "metric", "confidence", "based_on_posts"],
      },
    },
  },
  required: ["recommendations"],
};

/** The label is capped by the evidence: under 5 posts is an early signal, under 10 at most moderate. */
export function cappedConfidence(confidence: StrategyConfidence, basedOnPosts: number): StrategyConfidence {
  if (basedOnPosts < 5) return "early";
  if (basedOnPosts < 10 && confidence === "strong") return "moderate";
  return confidence;
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\*\*/g, "").trim().slice(0, max) : "");
const oneOf = <T extends string>(v: unknown, values: readonly T[], fallback: T): T => (values.includes(v as T) ? (v as T) : fallback);

/** The model's JSON → at most 5 complete recommendations; none usable is a "bad_output" error. */
export function parseStrategy(answer: string): StrategyRecommendation[] {
  let json: unknown;
  try {
    json = JSON.parse(answer.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  } catch {
    throw new TextGenerationError("bad_output", "The model's recommendations weren't valid JSON.", 200);
  }
  const items = Array.isArray((json as { recommendations?: unknown })?.recommendations) ? (json as { recommendations: unknown[] }).recommendations : [];
  const seen = new Set<string>();
  const out: StrategyRecommendation[] = [];
  for (const raw of items) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const rec = {
      actionEn: text(r.action_en, 140),
      actionAr: text(r.action_ar, 140),
      rationaleEn: text(r.rationale_en, 700),
      rationaleAr: text(r.rationale_ar, 700),
      category: oneOf(r.category, STRATEGY_CATEGORIES, "content"),
      metric: oneOf(r.metric, STRATEGY_METRICS, "interactions"),
      basedOnPosts: Math.max(0, Math.min(10_000, Math.round(Number(r.based_on_posts) || 0))),
      confidence: oneOf(r.confidence, STRATEGY_CONFIDENCE, "early"),
    };
    if (!rec.actionEn || !rec.actionAr || !rec.rationaleEn || !rec.rationaleAr) continue;
    const key = rec.actionEn.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...rec, confidence: cappedConfidence(rec.confidence, rec.basedOnPosts) });
    if (out.length === STRATEGY_MAX) break;
  }
  if (!out.length) throw new TextGenerationError("bad_output", "The model returned no usable recommendations.", 200);
  return out;
}

/**
 * Cache key of an analysis: the business data (without what changes on its own, like the
 * last sync time), past decisions and the prompt version. Timestamps count by the day, so
 * data dated relative to "now" (the demo data) doesn't look new on every read.
 * Same hash → the same answer would follow.
 */
export function strategyInputHash(facts: AssistantFacts, decisions: StrategyDecision[]): string {
  const stable = { ...facts, instagram: { ...facts.instagram, lastSyncAt: null } };
  const byDay = (_key: string, value: unknown) => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) ? value.slice(0, 10) : value);
  return createHash("sha256").update(JSON.stringify({ v: STRATEGY_PROMPT_VERSION, facts: stable, decisions }, byDay)).digest("hex");
}

// ─── Outcomes ────────────────────────────────────────────────────────────────

/** The numbers when a recommendation was marked Done: posts of the BASELINE_DAYS before, and followers. */
export interface OutcomeBaseline {
  at: string;
  posts: number;
  avgReach: number | null;
  avgInteractions: number | null;
  followers: number | null;
}

export type OutcomeVerdict = "up" | "down" | "no_clear_change" | "not_enough_data";

export interface OutcomeResult {
  metric: StrategyMetric;
  before: number | null;
  after: number | null;
  changePct: number | null;
  verdict: OutcomeVerdict;
  postsBefore: number;
  postsAfter: number;
  evaluatedAt: string;
}

const DAY = 24 * 60 * 60 * 1000;
const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
const round1 = (n: number) => Math.round(n * 10) / 10;

function postAverages(posts: AssistantPost[]) {
  const reached = posts.filter((p) => p.reach > 0);
  const reach = mean(reached.map((p) => p.reach));
  const interactions = mean(posts.map((p) => p.likes + p.comments));
  return { avgReach: reach === null ? null : Math.round(reach), avgInteractions: interactions === null ? null : round1(interactions) };
}

export function outcomeBaseline(posts: AssistantPost[], followers: number | null, at: Date): OutcomeBaseline {
  const from = at.getTime() - BASELINE_DAYS * DAY;
  const window = posts.filter((p) => {
    const t = new Date(p.postedAt).getTime();
    return t >= from && t < at.getTime();
  });
  return { at: at.toISOString(), posts: window.length, ...postAverages(window), followers };
}

/** Changes smaller than this (percent) are reported as "no clear change". */
export const NO_CLEAR_CHANGE_PCT = { reach: 10, interactions: 10, followers: 1 } as const;

/**
 * Compares the OUTCOME_DAYS after "Done" with the baseline. Honest by design: fewer than
 * 2 posts on either side is "not enough data", and small moves are "no clear change".
 */
export function compareOutcome(metric: StrategyMetric, baseline: OutcomeBaseline, posts: AssistantPost[], followersNow: number | null, now: Date): OutcomeResult {
  const start = new Date(baseline.at).getTime();
  const after = posts.filter((p) => {
    const t = new Date(p.postedAt).getTime();
    return t >= start && t < start + OUTCOME_DAYS * DAY;
  });
  const averages = postAverages(after);
  const before = metric === "followers" ? baseline.followers : metric === "reach" ? baseline.avgReach : baseline.avgInteractions;
  const value = metric === "followers" ? followersNow : metric === "reach" ? averages.avgReach : averages.avgInteractions;
  const base = { metric, before, after: value, postsBefore: baseline.posts, postsAfter: after.length, evaluatedAt: now.toISOString() };
  const thin = metric !== "followers" && (baseline.posts < 2 || after.length < 2);
  if (thin || before === null || value === null || before === 0) return { ...base, changePct: null, verdict: "not_enough_data" };
  const changePct = round1(((value - before) / before) * 100);
  const verdict: OutcomeVerdict = Math.abs(changePct) < NO_CLEAR_CHANGE_PCT[metric] ? "no_clear_change" : changePct > 0 ? "up" : "down";
  return { ...base, changePct, verdict };
}

/** One line for the next analysis, e.g. "reach +14% (3 posts before, 4 after)". */
export function outcomeSummary(o: OutcomeResult): string {
  if (o.verdict === "not_enough_data") return `${o.metric}: not enough data to judge`;
  return `${o.metric} ${o.changePct! > 0 ? "+" : ""}${o.changePct}% (${o.verdict === "no_clear_change" ? "no clear change" : o.verdict})`;
}
