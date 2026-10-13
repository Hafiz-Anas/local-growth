import { db } from "@/lib/db";
import { logActivity } from "@/lib/server/activity";
import { REPLY_SELECT, toReply } from "@/lib/server/dto";
import { requireAnyFeature } from "@/lib/server/guards";
import { ApiError, handler, ok, readJson, readParams } from "@/lib/server/http";
import { getInstagramAccount } from "@/lib/server/instagram-account";
import { sendDmReply } from "@/lib/server/instagram-dm";
import { instagramApiError } from "@/lib/server/instagram-errors";
import { sendKeywordReply, triggerForComment } from "@/lib/server/keyword-replies";
import { assertReplyKind, findPendingReply } from "@/lib/server/replies";
import { InstagramNotConnectedError, getInstagramService } from "@/lib/services/instagram";
import { approveReplySchema } from "@/lib/validation/api";

/**
 * POST /api/reply-drafts/:id/approve — approve and post the reply on Instagram:
 * under the comment, or as a direct message for DM drafts (lib/server/instagram-dm.ts).
 * The draft is claimed (PENDING → APPROVED) before posting so a double click
 * can't post twice; it becomes POSTED on success, or goes back to PENDING
 * (a DM whose 24-hour window closed becomes EXPIRED). A keyword reply draft also sends
 * the rule's private DM after the public reply; a DM failure is logged, not an error.
 */
export const POST = handler(async (request, context: RouteContext<"/api/reply-drafts/[id]/approve">) => {
  const { businessId, session, permissions } = await requireAnyFeature("engagement.aiReplies", "engagement.dmRules");
  const { id } = await readParams(context, "id");
  const reply = await findPendingReply(businessId, id);
  assertReplyKind(permissions, reply);
  const hasBody = request.headers.get("content-type")?.includes("application/json") ?? false;
  const body = hasBody ? await readJson(request, approveReplySchema) : {};
  const text = body.draftReply ?? reply.draftReply;
  const account = await getInstagramAccount(businessId);
  if (!account.connected) throw new ApiError(409, "instagram_not_connected", "Connect Instagram to post replies.");

  const claimed = await db.replyDraft.updateMany({ where: { id, status: "PENDING" }, data: { status: "APPROVED", reviewedBy: session.userId, draftReply: text } });
  if (claimed.count !== 1) throw new ApiError(409, "conflict", "This reply has already been handled.");

  if (reply.channel === "DM") {
    await sendDmReply({ businessId, draftId: id, recipientId: reply.recipientId ?? "", lastMessageAt: reply.lastMessageAt, text, userId: session.userId });
    return ok(toReply(await db.replyDraft.findUniqueOrThrow({ where: { id }, select: REPLY_SELECT })));
  }

  // A keyword rule without a public reply (rules made before keyword replies): only the private DM goes out.
  if ((reply.ruleId || reply.privateReply) && !text.trim()) {
    const trigger = await triggerForComment(businessId, reply.commentId);
    const result = await sendKeywordReply({ businessId, account, triggerId: null, ruleId: trigger?.ruleId ?? reply.ruleId, commentId: reply.commentId, commentedAt: reply.commentedAt, publicText: "", dmText: reply.privateReply ?? "" });
    if (result.outcome !== "sent") {
      await db.replyDraft.update({ where: { id }, data: { status: "PENDING", reviewedBy: null } });
      if (result.dmFailure === "needs_reconnect") throw new ApiError(409, "instagram_not_connected", "Connect Instagram again to continue.");
      if (result.dmFailure === "rate_limited") throw new ApiError(429, "rate_limited", "Instagram asked us to slow down. Try again in a few minutes.");
      const reason = result.dmFailure ?? "message_rejected";
      throw new ApiError(422, "dm_failed", `Instagram didn't deliver the message (${reason}).`, [{ path: "reason", message: reason }]);
    }
    if (trigger) await db.keywordReplyTrigger.update({ where: { id: trigger.id }, data: { status: "SENT", dmMessageId: result.dmMessageId } });
    const sent = await db.replyDraft.update({ where: { id }, data: { status: "POSTED" }, select: REPLY_SELECT });
    await logActivity({ businessId, userId: session.userId, action: "reply.approved", details: { replyDraftId: id } });
    return ok(toReply(sent));
  }

  let postedId: string;
  try {
    postedId = (await getInstagramService().replyToComment(account, reply.commentId, text)).id;
  } catch (error) {
    await db.replyDraft.update({ where: { id }, data: { status: "PENDING", reviewedBy: null } });
    if (error instanceof InstagramNotConnectedError) throw new ApiError(409, "instagram_not_connected", "Connect Instagram to post replies.");
    const apiError = instagramApiError(error, "Instagram didn't accept the reply. Try again.");
    if (apiError.code === "instagram_error") console.error("[instagram] replyToComment failed", error);
    throw apiError;
  }

  const updated = await db.replyDraft.update({ where: { id }, data: { status: "POSTED" }, select: REPLY_SELECT });
  await logActivity({ businessId, userId: session.userId, action: "reply.approved", details: { replyDraftId: id } });
  if (reply.ruleId || reply.privateReply) {
    const trigger = await triggerForComment(businessId, reply.commentId);
    await sendKeywordReply({
      businessId,
      account,
      triggerId: trigger?.id ?? null,
      ruleId: trigger?.ruleId ?? reply.ruleId,
      commentId: reply.commentId,
      commentedAt: reply.commentedAt,
      publicText: text,
      dmText: reply.privateReply ?? "",
      publicReplyId: postedId,
    });
  }
  return ok(toReply(updated));
});
