import "server-only";
import { db } from "@/lib/db";
import { isFeatureEnabled } from "@/lib/permissions";
import type { Permissions } from "@/types";
import { ApiError, notFound } from "./http";

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

/** A pending reply draft (comment or DM) of the caller's business, or 404 / 409. */
export async function findPendingReply(businessId: string, id: string) {
  const reply = await db.replyDraft.findFirst({
    where: { id, businessId },
    select: { id: true, status: true, channel: true, commentId: true, draftReply: true, recipientId: true, lastMessageAt: true, ruleId: true, privateReply: true, commentedAt: true },
  });
  if (!reply) throw notFound("Reply draft");
  if (reply.status === "EXPIRED") throw new ApiError(409, "dm_window_closed", "Instagram only allows replies within 24 hours of the customer's last message.");
  if (reply.status !== "PENDING") throw new ApiError(409, "conflict", "This reply has already been handled.");
  return reply;
}
