import { interactions, type AnalysisPost } from "./posts";

/**
 * Marketing methods: what kind of content a post is (collaboration, giveaway, offer, product,
 * behind the scenes, announcement, other). The format (Reel, carousel…) is measured separately.
 * Rules here give a first guess from the caption and mentions; the AI refines it for the
 * business's own posts and the client can correct it with one tap (stored, never overwritten).
 * "Promoted" is the client's own flag (we have no Ads API). Ranking compares averages — a
 * correlation, never proof that a method caused a result. Pure; tested in tests/analysis.test.ts.
 */

export const METHODS = ["collaboration", "giveaway", "offer", "product", "behind_the_scenes", "announcement", "other"] as const;
export type Method = (typeof METHODS)[number];

export const isMethod = (value: unknown): value is Method => typeof value === "string" && (METHODS as readonly string[]).includes(value);

/** Accounts mentioned in a caption (lowercase, without "@"), excluding the account itself. */
export function mentionsIn(caption: string, ownHandle = ""): string[] {
  const own = ownHandle.toLowerCase().replace(/^@/, "");
  const found = new Set<string>();
  for (const m of caption.matchAll(/(?:^|[^\p{L}\p{N}_.@])@([\p{L}\p{N}_.]{2,30})/gu)) {
    const handle = m[1].replace(/\.+$/, "").toLowerCase();
    if (handle && handle !== own) found.add(handle);
  }
  return [...found];
}

const RULES: Array<{ method: Method; pattern: RegExp }> = [
  { method: "giveaway", pattern: /giveaway|give away|win a|to win|contest|raffle|سحب|مسابقة|مسابقه|هدية لـ?\s*\d|فوز|اربح|إربح/iu },
  { method: "collaboration", pattern: /\bcollab|in collaboration|partnered with|together with|x @|بالتعاون|تعاون|شراكة|بالشراكة/iu },
  { method: "offer", pattern: /\d+\s?%|\boff\b|discount|sale\b|promo code|offer|deal|خصم|تخفيض|عرض|عروض|كود/iu },
  { method: "behind_the_scenes", pattern: /behind the scenes|\bbts\b|how we make|our team|meet the team|خلف الكواليس|وراء الكواليس|فريقنا|تعرفوا على/iu },
  { method: "announcement", pattern: /now open|opening|new branch|announce|coming soon|launch|we('| a)re open|افتتاح|فرع جديد|قريباً|قريبا|نعلن|إطلاق|اطلاق/iu },
  { method: "product", pattern: /new (in|arrival|flavou?r|collection)|back in stock|bestseller|best seller|available now|try (it|our)|menu|وصل|وصلت|جديدنا|متوفر|الأكثر مبيع|منيو|جربوا/iu },
];

/** First guess from the caption: an explicit signal wins; a mention of another account means a collaboration. */
export function ruleMethod(caption: string, ownHandle = ""): Method {
  const text = caption.normalize("NFKC");
  for (const rule of RULES) if (rule.pattern.test(text)) return rule.method;
  if (mentionsIn(text, ownHandle).length) return "collaboration";
  return text.trim() ? "product" : "other";
}

export interface ClassifiedPost extends AnalysisPost {
  method: Method;
  promoted: boolean;
}

export interface MethodRank {
  method: Method;
  posts: number;
  avgInteractions: number;
  /** Own posts with reach only. */
  avgReach: number | null;
  reachPosts: number;
  /** Average interactions vs the account's average across all the posts, percent (+25 = 25% above). */
  vsAveragePct: number;
  /** Fewer than MIN_POSTS_FOR_RANK posts: shown, but not ranked as a winner. */
  enoughData: boolean;
}

export const MIN_POSTS_FOR_RANK = 3;

const round = (n: number, digits = 1) => Math.round(n * 10 ** digits) / 10 ** digits;
const avg = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

/** Ranked by benefit: methods with enough posts first (by average interactions, then reach), then the rest. */
export function rankMethods(posts: ClassifiedPost[]): MethodRank[] {
  const overall = avg(posts.map(interactions));
  const ranks = METHODS.map((method) => {
    const group = posts.filter((p) => p.method === method);
    const reached = group.filter((p) => p.reach !== null && p.reach > 0);
    const avgInteractions = avg(group.map(interactions));
    return {
      method,
      posts: group.length,
      avgInteractions: round(avgInteractions),
      avgReach: reached.length ? Math.round(avg(reached.map((p) => p.reach!))) : null,
      reachPosts: reached.length,
      vsAveragePct: overall > 0 ? round(((avgInteractions - overall) / overall) * 100) : 0,
      enoughData: group.length >= MIN_POSTS_FOR_RANK,
    };
  }).filter((r) => r.posts > 0);
  return ranks.sort((a, b) => Number(b.enoughData) - Number(a.enoughData) || b.avgInteractions - a.avgInteractions || (b.avgReach ?? 0) - (a.avgReach ?? 0));
}

export interface PromotedComparison {
  promoted: { posts: number; avgInteractions: number; avgReach: number | null };
  organic: { posts: number; avgInteractions: number; avgReach: number | null };
  /** Promoted vs organic average interactions, percent; null without both groups. */
  diffPct: number | null;
  reachDiffPct: number | null;
  enoughData: boolean;
}

/** Promoted (marked by the client) vs normal posts, from the engagement data we already have. */
export function promotedVsOrganic(posts: ClassifiedPost[]): PromotedComparison {
  const side = (group: ClassifiedPost[]) => {
    const reached = group.filter((p) => p.reach !== null && p.reach > 0);
    return { posts: group.length, avgInteractions: round(avg(group.map(interactions))), avgReach: reached.length ? Math.round(avg(reached.map((p) => p.reach!))) : null };
  };
  const promoted = side(posts.filter((p) => p.promoted));
  const organic = side(posts.filter((p) => !p.promoted));
  const diff = (a: number | null, b: number | null) => (a !== null && b !== null && b > 0 && promoted.posts && organic.posts ? round(((a - b) / b) * 100) : null);
  return {
    promoted,
    organic,
    diffPct: diff(promoted.avgInteractions, organic.avgInteractions),
    reachDiffPct: diff(promoted.avgReach, organic.avgReach),
    enoughData: promoted.posts >= 2 && organic.posts >= MIN_POSTS_FOR_RANK,
  };
}

/** Method counts and averages for a competitor (rule-based estimate from captions only). */
export function methodMix(posts: AnalysisPost[], ownHandle = ""): Array<{ method: Method; posts: number; avgInteractions: number }> {
  return METHODS.map((method) => {
    const group = posts.filter((p) => ruleMethod(p.caption, ownHandle) === method);
    return { method, posts: group.length, avgInteractions: round(avg(group.map(interactions))) };
  })
    .filter((m) => m.posts > 0)
    .sort((a, b) => b.posts - a.posts);
}
