import { db } from "@/lib/db";
import { logActivity } from "@/lib/server/activity";
import { REPLY_SELECT, toReply } from "@/lib/server/dto";
import { requireFeature } from "@/lib/server/guards";
import { ApiError, handler, ok, readJson, readParams } from "@/lib/server/http";
import { getInstagramAccount } from "@/lib/server/instagram-account";
import { instagramApiError } from "@/lib/server/instagram-errors";
import { findPendingReply } from "@/lib/server/replies";
import { InstagramNotConnectedError, getInstagramService } from "@/lib/services/instagram";
import { approveReplySchema } from "@/lib/validation/api";

/**
 * POST /api/reply-drafts/:id/approve — approve and post the reply on Instagram.
 * The draft is claimed (PENDING → APPROVED) before posting so a double click
 * can't post twice; it becomes POSTED on success, or goes back to PENDING.
 */
export const POST = handler(async (request, context: RouteContext<"/api/reply-drafts/[id]/approve">) => {
  const { businessId, session } = await requireFeature("engagement.aiReplies");
  const { id } = await readParams(context, "id");
  const reply = await findPendingReply(businessId, id);
  const hasBody = request.headers.get("content-type")?.includes("application/json") ?? false;
  const body = hasBody ? await readJson(request, approveReplySchema) : {};
  const text = body.draftReply ?? reply.draftReply;
  const account = await getInstagramAccount(businessId);
  if (!account.connected) throw new ApiError(409, "instagram_not_connected", "Connect Instagram to post replies.");

  const claimed = await db.replyDraft.updateMany({ where: { id, status: "PENDING" }, data: { status: "APPROVED", reviewedBy: session.userId, draftReply: text } });
  if (claimed.count !== 1) throw new ApiError(409, "conflict", "This reply has already been handled.");

  try {
    await getInstagramService().replyToComment(account, reply.commentId, text);
  } catch (error) {
    await db.replyDraft.update({ where: { id }, data: { status: "PENDING", reviewedBy: null } });
    if (error instanceof InstagramNotConnectedError) throw new ApiError(409, "instagram_not_connected", "Connect Instagram to post replies.");
    const apiError = instagramApiError(error, "Instagram didn't accept the reply. Try again.");
    if (apiError.code === "instagram_error") console.error("[instagram] replyToComment failed", error);
    throw apiError;
  }

  const updated = await db.replyDraft.update({ where: { id }, data: { status: "POSTED" }, select: REPLY_SELECT });
  await logActivity({ businessId, userId: session.userId, action: "reply.approved", details: { replyDraftId: id } });
  return ok(toReply(updated));
});
