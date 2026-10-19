import "server-only";
import { db } from "@/lib/db";
import type { ReplyDraftStatus } from "@/lib/generated/prisma/client";
import { isFeatureEnabled } from "@/lib/permissions";
import { asIsRate, pickEditExamples, replyOutcome, type EditExample, type RegenerateTone } from "@/lib/replies";
import { getAIService, type ReplyRequest } from "@/lib/services/ai";
import type { Permissions, ReplyDraftDto, ReplySummaryDto } from "@/types";
import { FOCUS_SELECT, toBusinessFocus } from "./business-focus";
import { REPLY_SELECT, toReply } from "./dto";
import { ApiError, notFound } from "./http";
import { getRateLimiter, REPLY_REGENERATE_LIMIT } from "./rate-limit";

/**
 * The approval queue holds two kinds of drafts: AI replies (comments and DMs, feature
 * engagement.aiReplies) and keyword replies waiting for approval (ruleId set, feature
 * engagement.dmRules). Each kind is only visible and actionable with its own feature.
 */
export function replyKinds(permissions: Permissions) {
  return { ai: isFeatureEnabled(permissions, "engagement.aiReplies"), keyword: isFeatureEnabled(permissions, "engagement.dmRules") };
}

/** 404 when the caller's features don't cover this draft. */
export function assertReplyKind(permissions: Permissions, reply: { ruleId: string | null }) {
  const kinds = replyKinds(permissions);
  if (!(reply.ruleId ? kinds.keyword : kinds.ai)) throw notFound("Reply draft");
}

const PENDING_SELECT = {
  id: true,
  status: true,
  channel: true,
  commentId: true,
  commentText: true,
  commenterUsername: true,
  draftReply: true,
  aiReply: true,
  recipientId: true,
  lastMessageAt: true,
  ruleId: true,
  privateReply: true,
  commentedAt: true,
} as const;

/**
 * A pending reply draft (comment or DM) of the caller's business, or 404 / 409.
 * `allowBlocked`: also a draft that can't be sent any more (to remove it from the queue).
 */
export async function findPendingReply(businessId: string, id: string, options: { allowBlocked?: boolean } = {}) {
  const reply = await db.replyDraft.findFirst({ where: { id, businessId }, select: PENDING_SELECT });
  if (!reply) throw notFound("Reply draft");
  if (options.allowBlocked && (reply.status === "EXPIRED" || reply.status === "UNAVAILABLE")) return reply;
  if (reply.status === "EXPIRED") throw new ApiError(409, "dm_window_closed", "Instagram only allows replies within 24 hours of the customer's last message.");
  if (reply.status === "UNAVAILABLE") throw new ApiError(409, "comment_unavailable", "The comment was deleted, so it can't be answered any more.");
  if (reply.status !== "PENDING") throw new ApiError(409, "conflict", "This reply has already been handled.");
  return reply;
}

/** Outcome and send time for a reply that just went out (POSTED). */
export function sentFields(proposed: string | null, sent: string) {
  return { outcome: replyOutcome(proposed, sent).toUpperCase() as "AS_IS" | "EDITED" | "MANUAL", sentAt: new Date() };
}

// ── Learning from edits ───────────────────────────────────────────────────────

/**
 * A few recent AI drafts this business changed before sending (same channel), anonymised by
 * pickEditExamples: only the draft and the sent text, never the customer's message.
 */
export async function replyStyleExamples(businessId: string, channel: "comment" | "dm"): Promise<EditExample[]> {
  const rows = await db.replyDraft.findMany({
    where: { businessId, status: "POSTED", ruleId: null, channel: channel === "dm" ? "DM" : "COMMENT", outcome: { in: ["EDITED", "MANUAL"] } },
    select: { aiReply: true, draftReply: true, commenterUsername: true, commentText: true },
    orderBy: { sentAt: "desc" },
    take: 12,
  });
  return pickEditExamples(rows);
}

/** Everything an AI reply request needs about the business (sync, DMs and Regenerate share it). */
export async function replyRequestBase(businessId: string, channel: "comment" | "dm"): Promise<Omit<ReplyRequest, "commentText" | "commenterUsername"> | null> {
  const [business, examples] = await Promise.all([
    db.business.findUnique({ where: { id: businessId }, select: { ...FOCUS_SELECT, name: true, nameAr: true, brandVoice: { select: { toneLevel: true, brandWords: true, defaultHashtags: true } } } }),
    replyStyleExamples(businessId, channel),
  ]);
  if (!business) return null;
  const voice = business.brandVoice;
  return {
    businessId,
    businessName: business.name,
    businessNameAr: business.nameAr,
    niche: business.niche,
    focus: toBusinessFocus(business),
    brandVoice: { toneLevel: voice?.toneLevel ?? 50, brandWords: voice?.brandWords ?? [], defaultHashtags: voice?.defaultHashtags ?? [] },
    channel,
    examples,
  };
}

// ── Regenerate ────────────────────────────────────────────────────────────────

/** Customer text the AI answers: for a DM, the latest message(s) (the draft keeps everything since the last reply). */
const latestText = (text: string) => text.slice(-1000);

/**
 * "Regenerate": a new AI draft for a pending AI reply (not keyword replies — their text is the
 * rule's). Counts against REPLY_REGENERATE_LIMIT per business and the AI's own request gate
 * (per-minute and daily budget). On failure nothing changes: 503 regenerate_unavailable with the reason.
 */
export async function regenerateReply(businessId: string, id: string, tone: RegenerateTone | null): Promise<ReplyDraftDto> {
  const reply = await findPendingReply(businessId, id);
  if (reply.ruleId) throw new ApiError(409, "conflict", "Keyword replies use the rule's text; edit it instead.");
  const ai = getAIService();
  const availability = ai.textAvailability();
  if (!availability.available) throw regenerateUnavailable(availability.reason);
  if (!(await getRateLimiter().consume(REPLY_REGENERATE_LIMIT, businessId))) {
    throw new ApiError(429, "regenerate_limit", "You've asked for many new drafts in the last hour. Edit this one, or try again later.");
  }
  const channel = reply.channel === "DM" ? "dm" : "comment";
  const base = await replyRequestBase(businessId, channel);
  if (!base) throw notFound("Business");
  const answer = await ai.rewriteReply({ ...base, businessId, commentText: latestText(reply.commentText), commenterUsername: reply.commenterUsername, previous: reply.draftReply, tone });
  if (!answer.ok) throw regenerateUnavailable(answer.reason);

  // Only a draft still pending is replaced (it may have been sent meanwhile).
  const updated = await db.replyDraft.updateMany({
    where: { id, businessId, status: "PENDING" },
    data: { draftReply: answer.text, aiReply: answer.text, regenerations: { increment: 1 } },
  });
  if (updated.count !== 1) throw new ApiError(409, "conflict", "This reply has already been handled.");
  return toReply(await db.replyDraft.findUniqueOrThrow({ where: { id }, select: REPLY_SELECT }));
}

function regenerateUnavailable(reason: string) {
  return new ApiError(503, "regenerate_unavailable", "The AI can't write a new draft right now. You can still edit the reply and send it.", [{ path: "reason", message: reason }]);
}

// ── Queue lists and summary ───────────────────────────────────────────────────

/** How long a reply that can't be sent any more stays in the queue with its warning (until removed). */
export const BLOCKED_VISIBLE_MS = 7 * 24 * 60 * 60 * 1000;

export function kindFilter(kinds: { ai: boolean; keyword: boolean }) {
  return kinds.ai && kinds.keyword ? {} : { ruleId: kinds.keyword ? { not: null } : null };
}

/** The queue: pending drafts, plus recent ones that can't be sent any more (expired DM window, deleted comment). */
export function queueWhere(businessId: string, status: ReplyDraftStatus, kinds: { ai: boolean; keyword: boolean }) {
  if (status !== "PENDING") return { businessId, status, ...kindFilter(kinds) };
  return {
    businessId,
    ...kindFilter(kinds),
    OR: [{ status: "PENDING" as const }, { status: { in: ["EXPIRED", "UNAVAILABLE"] as ReplyDraftStatus[] }, createdAt: { gte: new Date(Date.now() - BLOCKED_VISIBLE_MS) } }],
  };
}

/** Sent replies in the last `days` days, by outcome. */
export async function replySummary(businessId: string, kinds: { ai: boolean; keyword: boolean }, days = 30): Promise<ReplySummaryDto> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const groups = await db.replyDraft.groupBy({
    by: ["outcome"],
    where: { businessId, status: "POSTED", sentAt: { gte: since }, outcome: { not: null }, ruleId: null },
    _count: { _all: true },
  });
  const keyword = kinds.keyword ? await db.replyDraft.count({ where: { businessId, status: "POSTED", sentAt: { gte: since }, ruleId: { not: null } } }) : 0;
  const count = (o: string) => (kinds.ai ? (groups.find((g) => g.outcome === o)?._count._all ?? 0) : 0);
  const ai = { as_is: count("AS_IS"), edited: count("EDITED"), manual: count("MANUAL") };
  const availability = kinds.ai ? getAIService().textAvailability() : { available: false as const, reason: "not_configured" as const };
  return {
    days,
    ai,
    keyword,
    asIsRate: asIsRate(ai),
    regenerate: availability.available ? { available: true, reason: null } : { available: false, reason: availability.reason },
  };
}
