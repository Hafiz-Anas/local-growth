/**
 * Keyword replies ("comment MENU and we'll send you the menu"): the matching and
 * decision rules, pure so tests cover them (tests/keyword-replies.test.ts). The
 * server side that stores, sends and logs lives in lib/server/keyword-replies.ts.
 *
 * Matching is case-insensitive and ignores punctuation, emojis and Arabic
 * diacritics; Arabic letter variants are folded (أ إ آ ٱ → ا, ى ی → ي, ة → ه).
 *   word  — the keyword appears as a whole word (or run of words) in the comment.
 *           An Arabic keyword also matches with the article: "منيو" matches "المنيو".
 *   exact — the whole comment is the keyword (after the clean-up above).
 */

export type KeywordMatchType = "word" | "exact";

/**
 * Instagram's limits, for forms and validation (the send paths check them again:
 * COMMENT_MAX_LENGTH in lib/services/meta/api.ts, DM_MAX_LENGTH in lib/services/meta/messaging.ts).
 */
export const PUBLIC_REPLY_MAX = 2200;
export const PRIVATE_REPLY_MAX = 1000;
export const MAX_RULE_KEYWORDS = 20;
export const MAX_RULE_POSTS = 50;

/** Same user + same rule: at most one reply in this window. */
export const KEYWORD_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const ARABIC_MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
const ARABIC_LETTER = /[؀-ۿ]/;

/** Lower-case, fold Arabic variants, drop diacritics, punctuation and emojis, collapse spaces. */
export function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(ARABIC_MARKS, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/[ىی]/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const tokens = (normalized: string) => (normalized ? normalized.split(" ") : []);

/** Whether `comment` triggers `keyword` with this match type. Empty keywords never match. */
export function matchesKeyword(comment: string, keyword: string, matchType: KeywordMatchType): boolean {
  const k = normalizeText(keyword);
  if (!k) return false;
  const c = normalizeText(comment);
  if (matchType === "exact") return c === k || (ARABIC_LETTER.test(k) && c === `ال${k}`);
  const words = tokens(c);
  const wanted = tokens(k);
  for (let i = 0; i + wanted.length <= words.length; i += 1) {
    if (wanted.every((w, j) => words[i + j] === w || (ARABIC_LETTER.test(w) && words[i + j] === `ال${w}`))) return true;
  }
  return false;
}

export interface KeywordRuleLike {
  id: string;
  keywords: string[];
  matchType: KeywordMatchType;
  active: boolean;
  /** "all" posts, or only the posts in mediaIds. */
  scope: "all" | "selected";
  mediaIds: string[];
  /** Rules don't answer comments written before they were created. */
  createdAt: Date;
}

export interface CommentLike {
  igCommentId: string;
  igMediaId: string | null;
  text: string;
  /** Lower-cased username, or the Instagram-scoped id when the username is unknown. */
  commenterKey: string;
  postedAt: Date;
}

/** The longest keyword of the rule that the comment matches (null: no match). */
export function matchedKeyword(rule: KeywordRuleLike, text: string): string | null {
  let best: string | null = null;
  for (const keyword of rule.keywords) {
    if (matchesKeyword(text, keyword, rule.matchType) && (!best || normalizeText(keyword).length > normalizeText(best).length)) best = keyword;
  }
  return best;
}

/**
 * Rules that match the comment, best first:
 *   1. "exact" rules before "word" rules (the more precise intent wins),
 *   2. then the longer matched keyword ("delivery price" before "price"),
 *   3. then the older rule, then the id (stable).
 * Paused rules, rules scoped to other posts and rules newer than the comment are left out.
 */
export function rankMatches<R extends KeywordRuleLike>(rules: R[], comment: Pick<CommentLike, "text" | "igMediaId" | "postedAt">): Array<{ rule: R; keyword: string }> {
  const matches: Array<{ rule: R; keyword: string }> = [];
  for (const rule of rules) {
    if (!rule.active) continue;
    if (rule.scope === "selected" && (!comment.igMediaId || !rule.mediaIds.includes(comment.igMediaId))) continue;
    if (comment.postedAt.getTime() < rule.createdAt.getTime()) continue;
    const keyword = matchedKeyword(rule, comment.text);
    if (keyword) matches.push({ rule, keyword });
  }
  return matches.sort(
    (a, b) =>
      (a.rule.matchType === "exact" ? 0 : 1) - (b.rule.matchType === "exact" ? 0 : 1) ||
      normalizeText(b.keyword).length - normalizeText(a.keyword).length ||
      a.rule.createdAt.getTime() - b.rule.createdAt.getTime() ||
      a.rule.id.localeCompare(b.rule.id),
  );
}

export interface RecentTrigger {
  ruleId: string;
  commenterKey: string;
  at: Date;
}

export type KeywordDecision<R extends KeywordRuleLike> =
  /** No rule matches: the comment goes on to the general AI reply draft as before. */
  | { action: "none" }
  /** Not ours to answer, and no general draft either. */
  | { action: "skip"; reason: "own_comment" | "already_handled" }
  /** Matching rules all answered this person within 24 hours: handled, nothing sent. */
  | { action: "cooldown"; rule: R; keyword: string }
  | { action: "reply"; rule: R; keyword: string };

/**
 * What to do with one comment. `alreadyHandled`: a rule or a reply draft already
 * covers this comment id (dedupe). `recent`: this business's triggers of the last
 * 24 hours (cooldown). A rule in cooldown for this person gives way to the next
 * matching rule; only when all are cooling down is the comment held back.
 */
export function decideKeywordReply<R extends KeywordRuleLike>(input: {
  comment: CommentLike;
  rules: R[];
  ownAccount: { igUserId?: string | null; username?: string | null };
  /** Id of the commenter, when known (webhooks carry it; the sync only the username). */
  commenterId?: string | null;
  alreadyHandled: boolean;
  recent: RecentTrigger[];
  now?: Date;
}): KeywordDecision<R> {
  const { comment, ownAccount } = input;
  const own = ownAccount.username?.toLowerCase();
  if ((own && comment.commenterKey === own) || (ownAccount.igUserId && input.commenterId === ownAccount.igUserId)) return { action: "skip", reason: "own_comment" };
  const matches = rankMatches(input.rules, comment);
  if (!matches.length) return { action: "none" };
  if (input.alreadyHandled) return { action: "skip", reason: "already_handled" };
  const now = (input.now ?? new Date()).getTime();
  const cooling = (ruleId: string) => input.recent.some((t) => t.ruleId === ruleId && t.commenterKey === comment.commenterKey && now - t.at.getTime() < KEYWORD_COOLDOWN_MS);
  const free = matches.find((m) => !cooling(m.rule.id));
  return free ? { action: "reply", ...free } : { action: "cooldown", ...matches[0] };
}
