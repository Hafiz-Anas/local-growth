import { db } from "@/lib/db";
import { logActivity } from "@/lib/server/activity";
import { REPLY_SELECT, toReply } from "@/lib/server/dto";
import { requireAnyFeature } from "@/lib/server/guards";
import { handler, ok, readParams } from "@/lib/server/http";
import { dismissKeywordTrigger } from "@/lib/server/keyword-replies";
import { assertReplyKind, findPendingReply } from "@/lib/server/replies";

/** POST /api/reply-drafts/:id/dismiss — don't reply to this comment; also removes a reply that can't be sent any more from the queue. */
export const POST = handler(async (_request, context: RouteContext<"/api/reply-drafts/[id]/dismiss">) => {
  const { businessId, session, permissions } = await requireAnyFeature("engagement.aiReplies", "engagement.dmRules");
  const { id } = await readParams(context, "id");
  const pending = await findPendingReply(businessId, id, { allowBlocked: true });
  assertReplyKind(permissions, pending);
  const reply = await db.replyDraft.update({ where: { id }, data: { status: "DISMISSED", reviewedBy: session.userId }, select: REPLY_SELECT });
  if (pending.ruleId && pending.status === "PENDING") await dismissKeywordTrigger(businessId, pending.commentId);
  await logActivity({ businessId, userId: session.userId, action: "reply.dismissed", details: { replyDraftId: id } });
  return ok(toReply(reply));
});
