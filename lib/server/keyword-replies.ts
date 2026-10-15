import "server-only";
import { db } from "@/lib/db";
import type { KeywordTriggerStatus } from "@/lib/generated/prisma/client";
import { decideKeywordReply, rankMatches, KEYWORD_COOLDOWN_MS, type KeywordRuleLike } from "@/lib/keyword-replies";
import { isFeatureEnabled, permissionsFromRows } from "@/lib/permissions";
import {
  InstagramMessagingError,
  InstagramNotConnectedError,
  InstagramPermissionError,
  InstagramRateLimitedError,
  getInstagramService,
  type InstagramAccount,
} from "@/lib/services/instagram";
import { COMMENT_MAX_LENGTH } from "@/lib/services/meta/api";
import { isMetaError } from "@/lib/services/meta/errors";
import { DM_MAX_LENGTH, PRIVATE_REPLY_WINDOW_MS, parseCommentWebhook, type IncomingComment } from "@/lib/services/meta/messaging";
import { logActivity } from "./activity";
import { getInstagramAccount } from "./instagram-account";
import { businessForAccount } from "./instagram-dm";
import { logIntegration } from "./integration-log";
import { notifyRepliesWaiting } from "./notifications";

/**
 * Keyword replies: a customer comments "MENU" and gets a public reply under the
 * comment plus, optionally, a private DM (Instagram private reply, by comment id).
 *
 * Comments arrive two ways:
 *   - real time: the "comments" webhook on /api/webhooks/instagram → handleCommentWebhook
 *   - fallback:  the Instagram sync (lib/server/instagram-sync.ts) runs every synced
 *                comment through the same KeywordReplier before drafting general AI replies
 * Matching and the decision (own comment, dedupe, 24-hour cooldown, rule priority) are
 * pure: lib/keyword-replies.ts.
 *
 * One KeywordReplyTrigger row per comment is the claim: the unique (business, comment)
 * index means a webhook retry or an overlapping sync can never reply twice. A comment a
 * rule handled never gets a general AI reply draft. With "send automatically" off the
 * reply waits in the Engagement approval queue (a ReplyDraft linked to the rule) and the
 * approve route sends it with sendKeywordReply. Every send and failure is written to the
 * integration log; nothing in here throws out of the webhook or the sync.
 */

const FEATURE = "engagement.dmRules" as const;
/** Statuses that count towards the 24-hour per-person cooldown. */
const COUNTED: KeywordTriggerStatus[] = ["SENDING", "AWAITING_APPROVAL", "SENT", "PARTIAL"];

const RULE_FIELDS = {
  id: true,
  keywords: true,
  matchType: true,
  active: true,
  scope: true,
  mediaIds: true,
  createdAt: true,
  commentReply: true,
  dmMessage: true,
  autoSend: true,
} as const;

type Rule = KeywordRuleLike & { commentReply: string; dmMessage: string; autoSend: boolean };

export interface KeywordComment {
  igCommentId: string;
  igMediaId: string | null;
  text: string;
  username: string | null;
  /** The commenter's Instagram-scoped id (webhooks only). */
  fromId: string | null;
  postedAt: Date;
  source: "webhook" | "sync";
}

/**
 * "none": no rule matched — the comment is free for a general AI reply draft.
 * Everything else means a rule (or an earlier run) has dealt with it.
 */
export type KeywordOutcome = "none" | "skipped" | "cooldown" | "queued" | "sent" | "partial" | "failed" | "retry_later";

export const commenterKeyOf = (c: Pick<KeywordComment, "username" | "fromId">) => (c.username ? c.username.toLowerCase() : (c.fromId ?? ""));

// ── Entry points ─────────────────────────────────────────────────────────────

export interface CommentWebhookSummary {
  comments: number;
  handled: number;
}

/** The "comments" changes of a webhook delivery. Never throws. */
export async function handleCommentWebhook(payload: unknown): Promise<CommentWebhookSummary> {
  const summary: CommentWebhookSummary = { comments: 0, handled: 0 };
  for (const comment of parseCommentWebhook(payload)) {
    summary.comments += 1;
    try {
      if ((await processWebhookComment(comment)) !== "none") summary.handled += 1;
    } catch (error) {
      console.error("[keyword] webhook comment failed", (error as Error).message);
    }
  }
  return summary;
}

async function processWebhookComment(comment: IncomingComment): Promise<KeywordOutcome> {
  // Replies inside a comment thread (including the business's own answers) aren't keyword triggers.
  if (comment.parentId) return "none";
  const connection = await businessForAccount(comment.accountId);
  if (!connection) {
    console.warn("[keyword] comment webhook for an Instagram account that isn't connected here; ignored.");
    return "none";
  }
  const { businessId } = connection;
  // Keep the synced comment list current between syncs (Meta connections; mock data comes from the packs).
  if (connection.provider === "META" && comment.mediaId && comment.fromUsername) {
    const data = { igMediaId: comment.mediaId, username: comment.fromUsername, text: comment.text, postedAt: comment.receivedAt, syncedAt: new Date() };
    await db.instagramMediaComment
      .upsert({ where: { businessId_igCommentId: { businessId, igCommentId: comment.commentId } }, update: { text: comment.text }, create: { businessId, igCommentId: comment.commentId, ...data } })
      .catch(() => undefined);
  }
  const replier = await keywordReplierFor(businessId);
  if (!replier) return "none";
  return replier.handle({
    igCommentId: comment.commentId,
    igMediaId: comment.mediaId,
    text: comment.text,
    username: comment.fromUsername,
    fromId: comment.fromId,
    postedAt: comment.receivedAt,
    source: "webhook",
  });
}

export interface KeywordReplier {
  handle(comment: KeywordComment): Promise<KeywordOutcome>;
}

/**
 * Rules and account of one business, loaded once (the sync runs many comments through it).
 * Null when keyword replies are off for the business or it has no active rule.
 */
export async function keywordReplierFor(businessId: string): Promise<KeywordReplier | null> {
  const rows = await db.featurePermission.findMany({ where: { businessId }, select: { featureKey: true, enabled: true } });
  if (!isFeatureEnabled(permissionsFromRows(rows), FEATURE)) return null;
  const rules: Rule[] = (await db.engagementRule.findMany({ where: { businessId, active: true }, select: RULE_FIELDS })).map((r) => ({
    ...r,
    matchType: r.matchType === "EXACT" ? "exact" : "word",
    scope: r.scope === "SELECTED_POSTS" ? "selected" : "all",
  }));
  if (!rules.length) return null;
  const account = await getInstagramAccount(businessId);
  return { handle: (comment) => handleComment(businessId, account, rules, comment) };
}

// ── One comment ──────────────────────────────────────────────────────────────

async function handleComment(businessId: string, account: InstagramAccount, rules: Rule[], comment: KeywordComment): Promise<KeywordOutcome> {
  const commenterKey = commenterKeyOf(comment);
  if (!commenterKey) return "none";
  const base = { igCommentId: comment.igCommentId, igMediaId: comment.igMediaId, text: comment.text, commenterKey, postedAt: comment.postedAt };
  // Cheap check first: most comments match nothing and need no database work.
  if (!rankMatches(rules, base).length) return "none";

  const [trigger, draft, recent] = await Promise.all([
    db.keywordReplyTrigger.findUnique({ where: { businessId_igCommentId: { businessId, igCommentId: comment.igCommentId } }, select: { id: true } }),
    db.replyDraft.findUnique({ where: { businessId_commentId: { businessId, commentId: comment.igCommentId } }, select: { id: true, status: true, ruleId: true } }),
    db.keywordReplyTrigger.findMany({
      where: { businessId, commenterKey, status: { in: COUNTED }, createdAt: { gte: new Date(Date.now() - KEYWORD_COOLDOWN_MS) }, ruleId: { not: null } },
      select: { ruleId: true, commenterKey: true, createdAt: true },
    }),
  ]);
  // A general AI draft still waiting for review gives way to the rule; anything else means it's been answered.
  const openGeneralDraft = draft && draft.status === "PENDING" && !draft.ruleId ? draft : null;
  const decision = decideKeywordReply({
    comment: base,
    rules,
    ownAccount: { igUserId: account.igUserId, username: account.username },
    commenterId: comment.fromId,
    alreadyHandled: Boolean(trigger) || (Boolean(draft) && !openGeneralDraft),
    recent: recent.map((t) => ({ ruleId: t.ruleId!, commenterKey: t.commenterKey, at: t.createdAt })),
  });
  if (decision.action === "none") return "none";
  if (decision.action === "skip") return "skipped";

  const { rule, keyword } = decision;
  if (!account.connected) {
    await logIntegration({ businessId, provider: account.provider, level: "warning", call: "keyword.reply", errorCode: "not_connected", message: `Keyword "${keyword}" matched a comment, but Instagram isn't connected, so nothing was sent.`, details: { ruleId: rule.id } });
    return "skipped";
  }

  // The claim: a second webhook delivery or an overlapping sync stops here.
  const claim = await claimComment(businessId, rule.id, comment, commenterKey, keyword, decision.action === "cooldown" ? "COOLDOWN" : "SENDING");
  if (!claim) return "skipped";
  if (openGeneralDraft) await db.replyDraft.update({ where: { id: openGeneralDraft.id }, data: { status: "DISMISSED" } });
  if (decision.action === "cooldown") return "cooldown";

  if (!rule.autoSend) {
    await db.replyDraft.upsert({
      where: { businessId_commentId: { businessId, commentId: comment.igCommentId } },
      update: { status: "PENDING", draftReply: rule.commentReply, aiReply: rule.commentReply, ruleId: rule.id, privateReply: rule.dmMessage || null, commentedAt: comment.postedAt, reviewedBy: null },
      create: {
        businessId,
        commentId: comment.igCommentId,
        commentText: comment.text,
        commenterUsername: comment.username ?? "",
        draftReply: rule.commentReply,
        aiReply: rule.commentReply,
        ruleId: rule.id,
        privateReply: rule.dmMessage || null,
        commentedAt: comment.postedAt,
      },
    });
    await finishTrigger(claim, rule.id, { status: "AWAITING_APPROVAL" });
    await notifyRepliesWaiting(businessId);
    await logIntegration({ businessId, provider: account.provider, level: "info", call: "keyword.queued", message: `Keyword "${keyword}" matched a comment; the reply is waiting for approval.`, details: { ruleId: rule.id, triggerId: claim } });
    return "queued";
  }

  const result = await sendKeywordReply({ businessId, account, triggerId: claim, ruleId: rule.id, commentId: comment.igCommentId, commentedAt: comment.postedAt, publicText: rule.commentReply, dmText: rule.dmMessage });
  return result.outcome;
}

async function claimComment(businessId: string, ruleId: string, comment: KeywordComment, commenterKey: string, keyword: string, status: KeywordTriggerStatus): Promise<string | null> {
  try {
    const row = await db.keywordReplyTrigger.create({
      data: {
        businessId,
        ruleId,
        igCommentId: comment.igCommentId,
        igMediaId: comment.igMediaId,
        commenterKey,
        commenterUsername: comment.username,
        commentText: comment.text.slice(0, 2000),
        keyword,
        source: comment.source,
        status,
        commentedAt: comment.postedAt,
      },
      select: { id: true },
    });
    return row.id;
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return null;
    throw error;
  }
}

/**
 * Records the outcome. Replies that went out (or now wait for approval) count as a trigger
 * of the rule — once: an approved draft was already counted when it was queued.
 */
async function finishTrigger(
  triggerId: string,
  ruleId: string | null,
  data: { status: KeywordTriggerStatus; replyCommentId?: string | null; dmMessageId?: string | null; failureReason?: string | null },
  { count = true } = {},
) {
  await db.keywordReplyTrigger.update({ where: { id: triggerId }, data });
  if (count && ruleId && (data.status === "SENT" || data.status === "PARTIAL" || data.status === "AWAITING_APPROVAL")) {
    await db.engagementRule.updateMany({ where: { id: ruleId }, data: { timesTriggered: { increment: 1 }, lastTriggeredAt: new Date() } });
  }
}

// ── Sending ──────────────────────────────────────────────────────────────────

/** Why one part wasn't sent. "rate_limited" is worth retrying later; the rest are final. */
type PartFailure = "too_long" | "needs_reconnect" | "rate_limited" | "permission" | "comment_deleted" | "failed" | "window_closed" | "already_replied" | "recipient_unavailable" | "message_rejected" | "comment_unavailable";

function failureOf(error: unknown): PartFailure {
  if (error instanceof InstagramNotConnectedError) return "needs_reconnect";
  if (error instanceof InstagramRateLimitedError) return "rate_limited";
  if (error instanceof InstagramPermissionError) return "permission";
  if (error instanceof InstagramMessagingError) return error.reason;
  if (isMetaError(error, "not_found")) return "comment_deleted";
  return "failed";
}

const MESSAGES: Record<PartFailure, string> = {
  too_long: "the text is longer than Instagram allows",
  needs_reconnect: "the Instagram connection expired; reconnect Instagram",
  rate_limited: "Instagram asked us to slow down; it will be retried",
  permission: "a permission is missing; reconnect Instagram and allow it",
  comment_deleted: "the comment was deleted",
  failed: "Instagram returned an error",
  window_closed: "private replies are only allowed within 7 days of the comment",
  already_replied: "this comment already got its one private reply",
  recipient_unavailable: "this person can't receive messages from the account",
  message_rejected: "Instagram rejected the message",
  comment_unavailable: "the comment was deleted",
};

export interface KeywordSendResult {
  outcome: Extract<KeywordOutcome, "sent" | "partial" | "failed" | "retry_later">;
  /** Failure of the public reply, if any (the approve route turns it into an API error). */
  replyError: unknown;
  replyFailure: PartFailure | null;
  dmFailure: PartFailure | null;
  /** Instagram id of the private DM, when it was sent. */
  dmMessageId: string | null;
}

/**
 * Sends a keyword reply: the public reply under the comment (when there's text), then the
 * private DM (when there's text). A deleted comment, an expired token or a rate limit stops
 * before the DM. Nothing sent because of a rate limit → the claim is released so the sync
 * retries later. Every send and failure goes to the integration log.
 */
export async function sendKeywordReply(input: {
  businessId: string;
  account: InstagramAccount;
  triggerId: string | null;
  ruleId: string | null;
  commentId: string;
  commentedAt: Date | null;
  publicText: string;
  dmText: string;
  /** The approve route has already posted the public reply (its Instagram id). */
  publicReplyId?: string;
}): Promise<KeywordSendResult> {
  const { businessId, account, ruleId, triggerId } = input;
  const service = getInstagramService();
  const details = { ...(ruleId && { ruleId }), ...(triggerId && { triggerId }) };
  const log = (level: "info" | "warning" | "error", call: string, message: string, errorCode?: string) =>
    logIntegration({ businessId, provider: account.provider, level, call, errorCode: errorCode ?? null, message, details });

  const publicAlreadySent = input.publicReplyId !== undefined;
  let replyCommentId: string | null = input.publicReplyId ?? null;
  let replyFailure: PartFailure | null = null;
  let replyError: unknown = null;
  const wantsPublic = Boolean(input.publicText.trim()) && !publicAlreadySent;
  if (wantsPublic) {
    if (input.publicText.length > COMMENT_MAX_LENGTH) replyFailure = "too_long";
    else {
      try {
        replyCommentId = (await service.replyToComment(account, input.commentId, input.publicText)).id;
        await log("info", "keyword.comment_reply", "Keyword reply posted under the comment.");
      } catch (error) {
        replyError = error;
        replyFailure = failureOf(error);
        if (replyFailure === "failed") console.error("[keyword] replyToComment failed", (error as Error)?.message);
      }
    }
    if (replyFailure) await log(replyFailure === "rate_limited" ? "warning" : "error", "keyword.comment_reply", `Keyword reply not posted: ${MESSAGES[replyFailure]}.`, replyFailure);
  }

  let dmMessageId: string | null = null;
  let dmFailure: PartFailure | null = null;
  const stop = replyFailure === "comment_deleted" || replyFailure === "comment_unavailable" || replyFailure === "needs_reconnect" || replyFailure === "rate_limited";
  const wantsDm = Boolean(input.dmText.trim()) && !stop;
  if (wantsDm) {
    if (input.dmText.length > DM_MAX_LENGTH) dmFailure = "too_long";
    else if (input.commentedAt && Date.now() - input.commentedAt.getTime() > PRIVATE_REPLY_WINDOW_MS) dmFailure = "window_closed";
    else {
      try {
        dmMessageId = (await service.sendPrivateReply(account, input.commentId, input.dmText)).id;
        await log("info", "keyword.private_reply", "Private reply (DM) sent to the commenter.");
      } catch (error) {
        dmFailure = failureOf(error);
        if (dmFailure === "failed") console.error("[keyword] sendPrivateReply failed", (error as Error)?.message);
      }
    }
    if (dmFailure) {
      const expected = dmFailure === "rate_limited" || dmFailure === "window_closed" || dmFailure === "already_replied" || dmFailure === "recipient_unavailable";
      await log(expected ? "warning" : "error", "keyword.private_reply", `Private reply not sent: ${MESSAGES[dmFailure]}.`, dmFailure);
    }
  }

  const sentSomething = Boolean(replyCommentId || dmMessageId || publicAlreadySent);
  const failedSomething = Boolean(replyFailure || dmFailure || (stop && input.dmText.trim()));
  const outcome: KeywordSendResult["outcome"] = !sentSomething
    ? replyFailure === "rate_limited" || dmFailure === "rate_limited"
      ? "retry_later"
      : "failed"
    : failedSomething
      ? "partial"
      : "sent";
  const failureReason = [replyFailure && `reply:${replyFailure}`, dmFailure && `dm:${dmFailure}`].filter(Boolean).join(" ") || null;

  if (triggerId) {
    if (outcome === "retry_later") await db.keywordReplyTrigger.deleteMany({ where: { id: triggerId } });
    else {
      const status = outcome === "sent" ? "SENT" : outcome === "partial" ? "PARTIAL" : "FAILED";
      await finishTrigger(triggerId, ruleId, { status, replyCommentId, dmMessageId, failureReason }, { count: !publicAlreadySent });
    }
  }
  if (replyCommentId || dmMessageId) {
    await logActivity({ businessId, action: "dm_rule.triggered", details: { ...details, publicReply: Boolean(replyCommentId), privateReply: Boolean(dmMessageId) } });
  }
  return { outcome, replyError, replyFailure, dmFailure, dmMessageId };
}

/** The trigger behind a keyword reply draft (approval queue). */
export function triggerForComment(businessId: string, commentId: string) {
  return db.keywordReplyTrigger.findUnique({ where: { businessId_igCommentId: { businessId, igCommentId: commentId } }, select: { id: true, ruleId: true } });
}

/** Approval draft dismissed: the trigger is closed too. */
export async function dismissKeywordTrigger(businessId: string, commentId: string) {
  await db.keywordReplyTrigger.updateMany({ where: { businessId, igCommentId: commentId, status: "AWAITING_APPROVAL" }, data: { status: "DISMISSED" } });
}
