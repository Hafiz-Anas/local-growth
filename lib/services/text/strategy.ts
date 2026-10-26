import { createHash } from "node:crypto";
import { impactRank, type BestSlot, type GrowthSignal, type Impact, type SignalKind } from "../../analysis/growth-signals";
import type { DayPart, PostFormat, Weekday } from "../../analysis/posts";
import type { AssistantFacts } from "./assistant";
import { TextGenerationError } from "./errors";
import { numbersIn } from "./report";

/**
 * Weekly tips (AI strategy recommendations), the pure parts: the growth signals as a data
 * block, the answer's schema and parsing — every tip must rest on one signal and quote the
 * owner's own numbers, any number not in the data rejects that tip — the ranking by expected
 * impact (set in code from the signal, never by the AI) and the 3-tip limit, the mock tips
 * written in code from the same signals, the cache hash, and the before/after comparison for
 * tips marked Done. Pure (no server-only) so it can be unit-tested (tests/gemini/strategy.test.ts).
 */

/** Bump when the prompt or the schema changes, so cached results are re-analysed. */
export const STRATEGY_PROMPT_VERSION = 3;
/** Tips per weekly analysis, at most. */
export const STRATEGY_MAX = 3;
/** Days between a tip marked Done and its result check. */
export const OUTCOME_DAYS = 7;
/** Days of posts before "Done" that make the baseline. */
export const BASELINE_DAYS = 14;

export const STRATEGY_CATEGORIES = ["content", "timing", "format", "engagement", "hashtags", "competitors", "shares", "saves", "comments"] as const;
/** reach / interactions / followers are also on tips from before the growth signals. */
export const STRATEGY_METRICS = ["reach", "interactions", "followers", "shares", "saves", "comments"] as const;
export const STRATEGY_CONFIDENCE = ["strong", "moderate", "early"] as const;
export type StrategyCategory = (typeof STRATEGY_CATEGORIES)[number];
export type StrategyMetric = (typeof STRATEGY_METRICS)[number];
export type StrategyConfidence = (typeof STRATEGY_CONFIDENCE)[number];

export interface StrategyRecommendation {
  actionEn: string;
  actionAr: string;
  /** The short "Why" line with the numbers. */
  rationaleEn: string;
  rationaleAr: string;
  category: StrategyCategory;
  metric: StrategyMetric;
  confidence: StrategyConfidence;
  basedOnPosts: number;
  impact: Impact;
  signalId: string;
}

/** A past tip and what the owner did with it (fed into the next analysis). */
export interface StrategyDecision {
  status: "accepted" | "dismissed" | "done";
  /** ISO date of the decision. */
  at: string;
  action: string;
  /** For Done ones that have been measured. */
  outcome?: string | null;
}

/** What the mock (and the prompt) know about the business to make a tip fit it. */
export interface TipBusiness {
  type: string | null;
  /** Products / menu categories from onboarding. */
  products: string[];
}

// ─── Words ───────────────────────────────────────────────────────────────────

const FORMAT: Record<PostFormat, { en: string; enOne: string; ar: string }> = {
  reel: { en: "Reels", enOne: "Reel", ar: "الريلز" },
  carousel: { en: "carousels", enOne: "carousel", ar: "المنشورات متعددة الصور" },
  photo: { en: "photos", enOne: "photo", ar: "الصور" },
  video: { en: "videos", enOne: "video", ar: "الفيديوهات" },
};
const DAY: Record<Weekday, { en: string; ar: string }> = {
  mon: { en: "Monday", ar: "الاثنين" },
  tue: { en: "Tuesday", ar: "الثلاثاء" },
  wed: { en: "Wednesday", ar: "الأربعاء" },
  thu: { en: "Thursday", ar: "الخميس" },
  fri: { en: "Friday", ar: "الجمعة" },
  sat: { en: "Saturday", ar: "السبت" },
  sun: { en: "Sunday", ar: "الأحد" },
};
/** Each part of the day with the hour a tip suggests (local time). */
const PART: Record<DayPart, { en: string; ar: string; range: string; hourEn: string; hourAr: string; hour24: string }> = {
  morning: { en: "morning", ar: "الصباح", range: "06:00–12:00", hourEn: "10am", hourAr: "10 صباحاً", hour24: "10:00" },
  afternoon: { en: "afternoon", ar: "الظهر", range: "12:00–17:00", hourEn: "2pm", hourAr: "2 ظهراً", hour24: "14:00" },
  evening: { en: "evening", ar: "المساء", range: "17:00–22:00", hourEn: "8pm", hourAr: "8 مساءً", hour24: "20:00" },
  night: { en: "night", ar: "الليل", range: "22:00–06:00", hourEn: "10pm", hourAr: "10 ليلاً", hour24: "22:00" },
};
const KIND_LABEL: Record<SignalKind, string> = { shares: "SHARES", saves: "SAVES", comments: "COMMENTS", reach_format: "REACH BY POST TYPE", reach_time: "REACH BY POSTING TIME" };
const KIND_CATEGORY: Record<SignalKind, StrategyCategory> = { shares: "shares", saves: "saves", comments: "comments", reach_format: "format", reach_time: "timing" };

const postsWord = (n: number) => (n === 1 ? "1 post" : `${n} posts`);
const slotEn = (s: { weekday: Weekday | null; dayPart: DayPart | null }) => `${s.weekday ? `${DAY[s.weekday].en} ` : ""}${s.dayPart ? PART[s.dayPart].en : ""}`.trim();

/** One line per signal: the only numbers a tip may quote (with the rest of the data block). */
export function signalLines(signals: GrowthSignal[], bestSlot: BestSlot | null): string[] {
  if (!signals.length) return [];
  const line = (s: GrowthSignal) => {
    const lift = `+${s.liftPct}%`;
    const what =
      s.kind === "shares"
        ? `${FORMAT[s.format!].en}: ${s.value}% of the people they reach share them, vs ${s.average}% for all posts (${lift})`
        : s.kind === "saves"
          ? `${FORMAT[s.format!].en}: ${s.value}% of the people they reach save them, vs ${s.average}% for all posts (${lift})`
          : s.kind === "comments"
            ? `${FORMAT[s.format!].en}: ${s.value} comments per post, vs ${s.average} for all posts (${lift})`
            : s.kind === "reach_format"
              ? `${FORMAT[s.format!].en}: reach ${s.value} per post, vs ${s.average} for all posts (${lift})`
              : `posts on ${slotEn(s)} (${PART[s.dayPart!].range}): reach ${s.value} per post, vs ${s.average} for all posts (${lift})`;
    return `[${s.id}] ${KIND_LABEL[s.kind]} — ${what}, over ${postsWord(s.posts)}. Expected impact: ${s.impact}.`;
  };
  return [
    "",
    "## Growth signals (computed by the app from the business's own posts; ranked by expected impact)",
    "Instagram rewards posts people send to friends (shares), save, and comment on; reach follows. Each tip must rest on one of these signals.",
    ...signals.map(line),
    bestSlot ? `Best time to post (highest average reach): ${slotEn(bestSlot)} (${PART[bestSlot.dayPart].range}, suggest ${PART[bestSlot.dayPart].hour24}).` : null,
  ].filter((l): l is string => l !== null);
}

// ─── The answer ──────────────────────────────────────────────────────────────

export const STRATEGY_SCHEMA = {
  type: "OBJECT",
  properties: {
    recommendations: {
      type: "ARRAY",
      description: `At most ${STRATEGY_MAX} tips, one per signal.`,
      items: {
        type: "OBJECT",
        properties: {
          signal_id: { type: "STRING", description: 'The id of the growth signal the tip rests on, e.g. "s1".' },
          action_en: { type: "STRING", description: "What to post, when and how, for this business and its products, imperative, under 120 characters." },
          action_ar: { type: "STRING", description: "The same action in Arabic." },
          why_en: { type: "STRING", description: "One short sentence quoting the signal's numbers exactly as given." },
          why_ar: { type: "STRING", description: "The same in Arabic." },
        },
        required: ["signal_id", "action_en", "action_ar", "why_en", "why_ar"],
      },
    },
  },
  required: ["recommendations"],
};

/** Confidence from how many posts the signal rests on: 10+ strong, 5–9 moderate, else an early signal. */
export function confidenceFor(basedOnPosts: number): StrategyConfidence {
  if (basedOnPosts >= 10) return "strong";
  if (basedOnPosts >= 5) return "moderate";
  return "early";
}

const ARABIC_DIGITS = /[٠-٩]/g;
const westernDigits = (text: string) => text.replace(ARABIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/٫/g, ".").replace(/٪/g, "%");

/** Times and durations are instructions ("Thursday at 8pm", "a 15-second Reel"), not claims about the data. */
const INSTRUCTION_NUMBERS = [
  /\b\d{1,2}:\d{2}\b/g,
  /\b\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)\b/gi,
  /\b\d{1,3}[-\s]?(?:seconds?|secs?|s)\b/gi,
  /\d{1,2}(?::\d{2})?\s*(?:صباحاً|صباحا|مساءً|مساء|ظهراً|ظهرا|ليلاً|ليلا)/g,
  /\d{1,3}\s*(?:ثانية|ثوانٍ|ثوان|ثواني)/g,
];
/** Small counts ("3 posts", "5 photos") are fine; a percent or a ratio never is unless it's in the data. */
const SMALL_COUNT = 7;

function allowedNumbers(data: string): Set<number> {
  const allowed = new Set<number>();
  for (const n of numbersIn(data)) {
    allowed.add(n);
    allowed.add(Math.round(n));
    allowed.add(Math.round(n * 10) / 10);
  }
  return allowed;
}

/** The numbers a tip states, with whether each is a percent / ratio (times and durations left out). */
function claimedNumbers(text: string): Array<{ n: number; rate: boolean }> {
  let t = westernDigits(text).replace(/(\d)[,٬](?=\d{3}\b)/g, "$1");
  for (const re of INSTRUCTION_NUMBERS) t = t.replace(re, " ");
  return [...t.matchAll(/(\d+(?:\.\d+)?)\s*([%x×])?/g)].map((m) => ({ n: Number(m[1]), rate: Boolean(m[2]) }));
}

/** True when every number the text states is in the data (exactly or rounded), or is a small count. */
export function tipUsesOnlyGivenNumbers(text: string, data: string): boolean {
  const allowed = allowedNumbers(data);
  return claimedNumbers(text).every(({ n, rate }) => allowed.has(n) || (!rate && Number.isInteger(n) && n <= SMALL_COUNT));
}

/** The "Why" must quote the signal itself: its number, the average or the lift. */
export function quotesSignal(why: string, signal: Pick<GrowthSignal, "value" | "average" | "liftPct">): boolean {
  const targets = [signal.value, signal.average, signal.liftPct].flatMap((v) => [v, Math.round(v), Math.round(v * 10) / 10]);
  return claimedNumbers(why).some(({ n }) => targets.includes(n));
}

/** Highest impact first; ties keep the signals' order (their strength). */
export function rankTips<T extends { impact: Impact; signalId: string }>(tips: T[], signals: Array<Pick<GrowthSignal, "id">>): T[] {
  const order = (id: string) => {
    const i = signals.findIndex((s) => s.id === id);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...tips].sort((a, b) => impactRank(a.impact) - impactRank(b.impact) || order(a.signalId) - order(b.signalId));
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\*\*/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "");

/** A tip on a signal: impact, metric, category and post count come from the signal, never from the model. */
function tipOn(signal: GrowthSignal, t: { actionEn: string; actionAr: string; rationaleEn: string; rationaleAr: string }): StrategyRecommendation {
  return { ...t, category: KIND_CATEGORY[signal.kind], metric: signal.metric, basedOnPosts: signal.posts, confidence: confidenceFor(signal.posts), impact: signal.impact, signalId: signal.id };
}

/**
 * The model's JSON → at most STRATEGY_MAX tips, ranked by impact. A tip is dropped when it names
 * no known signal, repeats one, misses a language, quotes no number of its signal, or states any
 * number that isn't in the data. None left is a "bad_output" error.
 */
export function parseStrategy(answer: string, { data, signals }: { data: string; signals: GrowthSignal[] }): StrategyRecommendation[] {
  let json: unknown;
  try {
    json = JSON.parse(answer.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  } catch {
    throw new TextGenerationError("bad_output", "The model's tips weren't valid JSON.", 200);
  }
  const items = Array.isArray((json as { recommendations?: unknown })?.recommendations) ? (json as { recommendations: unknown[] }).recommendations : [];
  const used = new Set<string>();
  const out: StrategyRecommendation[] = [];
  let invented = 0;
  for (const raw of items) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const signal = signals.find((s) => s.id === text(r.signal_id, 10).toLowerCase());
    const tip = { actionEn: text(r.action_en, 160), actionAr: text(r.action_ar, 160), rationaleEn: text(r.why_en, 300), rationaleAr: text(r.why_ar, 300) };
    if (!signal || used.has(signal.id) || !tip.actionEn || !tip.actionAr || !tip.rationaleEn || !tip.rationaleAr) continue;
    const honest = Object.values(tip).every((t) => tipUsesOnlyGivenNumbers(t, data)) && quotesSignal(tip.rationaleEn, signal) && quotesSignal(tip.rationaleAr, signal);
    if (!honest) {
      invented += 1;
      continue;
    }
    used.add(signal.id);
    out.push(tipOn(signal, tip));
  }
  if (!out.length) {
    throw new TextGenerationError("bad_output", invented ? "Every tip quoted numbers that aren't in the data." : "The model returned no usable tips.", 200);
  }
  return rankTips(out, signals).slice(0, STRATEGY_MAX);
}

// ─── The mock: tips written in code from the signals ─────────────────────────

/** "6,106": thousands separated, decimals as they are (the number check reads both). */
const num = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

const FOOD = /caf[eé]|coffee|bak|cake|sweet|dessert|food|restaurant|kitchen|roast|nut|chocolate|juice|grill|burger|pizza|kunafa|مقهى|قهوة|حلويات|مطعم|مخبز|محمصة/i;

/** The product a tip shows: the onboarding products in turn, else a plain "best-seller". */
function productFor(business: TipBusiness, i: number): { en: string; ar: string } {
  const p = business.products.map((x) => x.trim()).filter(Boolean);
  if (p.length) return { en: p[i % p.length], ar: p[i % p.length] };
  return { en: "your best-seller", ar: "أكثر منتج مطلوب لديكم" };
}

/** "a 15-second Reel of your kunafa being made" — what to post, by post type. */
function showing(format: PostFormat, product: { en: string; ar: string }, food: boolean): { en: string; ar: string } {
  switch (format) {
    case "reel":
      return food
        ? { en: `a 15-second Reel of ${product.en} being made`, ar: `ريل مدته 15 ثانية لـ${product.ar} أثناء التحضير` }
        : { en: `a 15-second Reel showing ${product.en} up close`, ar: `ريل مدته 15 ثانية يعرض ${product.ar} عن قرب` };
    case "carousel":
      return { en: `a carousel of 5 close-up photos of ${product.en}`, ar: `منشوراً من 5 صور قريبة لـ${product.ar}` };
    case "video":
      return { en: `a 30-second video of ${product.en}${food ? " being made" : " in use"}`, ar: `فيديو مدته 30 ثانية لـ${product.ar}${food ? " أثناء التحضير" : " أثناء الاستخدام"}` };
    default:
      return { en: `a close-up photo of ${product.en} in natural light`, ar: `صورة قريبة لـ${product.ar} بإضاءة طبيعية` };
  }
}

function when(slot: { weekday: Weekday | null; dayPart: DayPart | null } | null): { en: string; ar: string } {
  if (!slot?.dayPart) return { en: "this week", ar: "هذا الأسبوع" };
  const part = PART[slot.dayPart];
  return slot.weekday ? { en: `on ${DAY[slot.weekday].en} at ${part.hourEn}`, ar: `يوم ${DAY[slot.weekday].ar} الساعة ${part.hourAr}` } : { en: `at ${part.hourEn}`, ar: `الساعة ${part.hourAr}` };
}

/**
 * MOCK tips: the top signals (at most STRATEGY_MAX, ranked by impact) as specific actions for this
 * business — its products, its best post type and its best time — with a "Why" line quoting the
 * signal's numbers. Like the AI, it doesn't repeat a tip the owner dismissed, is still doing
 * (accepted), or marked done and is waiting for its result. Empty when there are no signals.
 */
export function mockStrategyTips(signals: GrowthSignal[], bestSlot: BestSlot | null, business: TipBusiness, decisions: StrategyDecision[] = []): StrategyRecommendation[] {
  const skip = new Set(decisions.filter((d) => d.status !== "done" || !d.outcome).map((d) => d.action));
  const food = FOOD.test(`${business.type ?? ""} ${business.products.join(" ")}`);
  const timing = signals.find((s) => s.kind === "reach_time") ?? null;
  const at = when(timing ?? bestSlot);
  const bestFormat = signals.find((s) => s.format)?.format ?? "reel";
  const tips = signals.map((s, i) => {
    const product = productFor(business, i);
    const show = showing(s.format ?? bestFormat, product, food);
    const f = s.format ? FORMAT[s.format] : null;
    switch (s.kind) {
      case "shares":
        return tipOn(s, {
          actionEn: `Post ${show.en} ${at.en}, ending with "Send this to someone who'd love it"`,
          actionAr: `انشروا ${show.ar} ${at.ar}، واختموا بـ"أرسلوه لشخص يحبه"`,
          rationaleEn: `Your ${f!.en} get shared most: ${num(s.value)}% of the people they reach send them on, vs ${num(s.average)}% across your posts (${postsWord(s.posts)}).`,
          rationaleAr: `${f!.ar} هي الأكثر مشاركة لديكم: يرسلها ${num(s.value)}% ممن تصلهم، مقابل ${num(s.average)}% لكل منشوراتكم (عدد المنشورات: ${s.posts}).`,
        });
      case "saves":
        return tipOn(s, {
          actionEn: `Post ${show.en} ${at.en}, with one tip worth saving`,
          actionAr: `انشروا ${show.ar} ${at.ar}، مع نصيحة تستحق الحفظ`,
          rationaleEn: `Your ${f!.en} get saved most: ${num(s.value)}% of the people they reach save them, vs ${num(s.average)}% across your posts (${postsWord(s.posts)}).`,
          rationaleAr: `${f!.ar} هي الأكثر حفظاً لديكم: يحفظها ${num(s.value)}% ممن تصلهم، مقابل ${num(s.average)}% لكل منشوراتكم (عدد المنشورات: ${s.posts}).`,
        });
      case "comments":
        return tipOn(s, {
          actionEn: `Post ${show.en} ${at.en}, asking followers to pick a favourite in the comments`,
          actionAr: `انشروا ${show.ar} ${at.ar}، واسألوا متابعيكم عن المفضل لديهم في التعليقات`,
          rationaleEn: `Your ${f!.en} get the most comments: ${num(s.value)} per post, vs ${num(s.average)} across your posts (${postsWord(s.posts)}).`,
          rationaleAr: `${f!.ar} تحصل على أكثر التعليقات لديكم: ${num(s.value)} لكل منشور، مقابل ${num(s.average)} لكل منشوراتكم (عدد المنشورات: ${s.posts}).`,
        });
      case "reach_format":
        return tipOn(s, {
          actionEn: `Make your next 2 posts ${f!.en}: start with ${show.en} ${at.en}`,
          actionAr: `اجعلوا منشوريكم القادمين من ${f!.ar}: ابدؤوا بـ${show.ar} ${at.ar}`,
          rationaleEn: `Your ${f!.en} reach ${num(s.value)} people per post, vs ${num(s.average)} across your posts (+${s.liftPct}%, ${postsWord(s.posts)}).`,
          rationaleAr: `تصل ${f!.ar} لديكم إلى ${num(s.value)} شخص لكل منشور، مقابل ${num(s.average)} لكل منشوراتكم (+${s.liftPct}%، عدد المنشورات: ${s.posts}).`,
        });
      case "reach_time": {
        const slot = when(s);
        const timeAr = `${s.weekday ? `يوم ${DAY[s.weekday].ar} ` : ""}${PART[s.dayPart!].ar}`;
        return tipOn(s, {
          actionEn: `Post ${show.en} ${slot.en}, your strongest time slot`,
          actionAr: `انشروا ${show.ar} ${slot.ar}، في أقوى وقت لديكم`,
          rationaleEn: `Posts on ${slotEn(s)} reach ${num(s.value)} people on average, vs ${num(s.average)} overall (+${s.liftPct}%, ${postsWord(s.posts)}).`,
          rationaleAr: `منشوراتكم في ${timeAr} تصل إلى ${num(s.value)} شخص في المتوسط، مقابل ${num(s.average)} عموماً (+${s.liftPct}%، عدد المنشورات: ${s.posts}).`,
        });
      }
    }
  });
  return rankTips(tips.filter((t) => !skip.has(t.actionEn)), signals).slice(0, STRATEGY_MAX);
}

/**
 * Cache key of an analysis: the business data (without what changes on its own, like the
 * last sync time), the signals, past decisions and the prompt version. Timestamps count by the
 * day, so data dated relative to "now" (the demo data) doesn't look new on every read.
 * Same hash → the same answer would follow.
 */
export function strategyInputHash(facts: AssistantFacts, decisions: StrategyDecision[], signals: GrowthSignal[] = []): string {
  const stable = { ...facts, instagram: { ...facts.instagram, lastSyncAt: null } };
  const byDay = (_key: string, value: unknown) => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) ? value.slice(0, 10) : value);
  return createHash("sha256").update(JSON.stringify({ v: STRATEGY_PROMPT_VERSION, facts: stable, signals, decisions }, byDay)).digest("hex");
}

// ─── Outcomes ────────────────────────────────────────────────────────────────

/** A post as the outcome check sees it: reach / saves / shares are null when Instagram has none. */
export interface OutcomePost {
  postedAt: string;
  likes: number;
  comments: number;
  reach: number | null;
  saves: number | null;
  shares?: number | null;
}

/** The numbers when a tip was marked Done: posts of the BASELINE_DAYS before, and followers. */
export interface OutcomeBaseline {
  at: string;
  posts: number;
  avgReach: number | null;
  avgInteractions: number | null;
  /** Missing on baselines stored before the growth signals. */
  avgComments?: number | null;
  avgSaves?: number | null;
  avgShares?: number | null;
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

const DAY_MS = 24 * 60 * 60 * 1000;
const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
const round1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

function postAverages(posts: OutcomePost[]) {
  const reached = posts.filter((p) => p.reach !== null && p.reach > 0);
  const reach = mean(reached.map((p) => p.reach!));
  return {
    avgReach: reach === null ? null : Math.round(reach),
    avgInteractions: round1(mean(posts.map((p) => p.likes + p.comments))),
    avgComments: round1(mean(posts.map((p) => p.comments))),
    avgSaves: round1(mean(reached.filter((p) => p.saves !== null).map((p) => p.saves!))),
    avgShares: round1(mean(posts.filter((p) => p.shares !== null && p.shares !== undefined).map((p) => p.shares!))),
  };
}

const inWindow = (posts: OutcomePost[], from: number, to: number) =>
  posts.filter((p) => {
    const t = new Date(p.postedAt).getTime();
    return t >= from && t < to;
  });

export function outcomeBaseline(posts: OutcomePost[], followers: number | null, at: Date): OutcomeBaseline {
  const window = inWindow(posts, at.getTime() - BASELINE_DAYS * DAY_MS, at.getTime());
  return { at: at.toISOString(), posts: window.length, ...postAverages(window), followers };
}

/** Changes smaller than this (percent) are reported as "no clear change". */
export const NO_CLEAR_CHANGE_PCT: Record<StrategyMetric, number> = { reach: 10, interactions: 10, followers: 1, shares: 10, saves: 10, comments: 10 };

const AVERAGE_OF: Record<Exclude<StrategyMetric, "followers">, keyof ReturnType<typeof postAverages>> = {
  reach: "avgReach",
  interactions: "avgInteractions",
  comments: "avgComments",
  saves: "avgSaves",
  shares: "avgShares",
};

/**
 * Compares the OUTCOME_DAYS after "Done" with the baseline. Honest by design: fewer than
 * 2 posts on either side is "not enough data", and small moves are "no clear change".
 */
export function compareOutcome(metric: StrategyMetric, baseline: OutcomeBaseline, posts: OutcomePost[], followersNow: number | null, now: Date): OutcomeResult {
  const start = new Date(baseline.at).getTime();
  const after = inWindow(posts, start, start + OUTCOME_DAYS * DAY_MS);
  const averages = postAverages(after);
  const before = metric === "followers" ? baseline.followers : (baseline[AVERAGE_OF[metric]] ?? null);
  const value = metric === "followers" ? followersNow : averages[AVERAGE_OF[metric]];
  const base = { metric, before, after: value, postsBefore: baseline.posts, postsAfter: after.length, evaluatedAt: now.toISOString() };
  const thin = metric !== "followers" && (baseline.posts < 2 || after.length < 2);
  if (thin || before === null || value === null || before === 0) return { ...base, changePct: null, verdict: "not_enough_data" };
  const changePct = Math.round(((value - before) / before) * 1000) / 10;
  const verdict: OutcomeVerdict = Math.abs(changePct) < NO_CLEAR_CHANGE_PCT[metric] ? "no_clear_change" : changePct > 0 ? "up" : "down";
  return { ...base, changePct, verdict };
}

/** One line for the next analysis, e.g. "reach +14% (up)". */
export function outcomeSummary(o: OutcomeResult): string {
  if (o.verdict === "not_enough_data") return `${o.metric}: not enough data to judge`;
  return `${o.metric} ${o.changePct! > 0 ? "+" : ""}${o.changePct}% (${o.verdict === "no_clear_change" ? "no clear change" : o.verdict})`;
}
