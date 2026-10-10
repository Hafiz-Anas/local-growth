import { db } from "@/lib/db";
import { logActivity } from "@/lib/server/activity";
import { REPLY_SELECT, toReply } from "@/lib/server/dto";
import { requireFeature } from "@/lib/server/guards";
import { handler, ok, readParams } from "@/lib/server/http";
import { findPendingReply } from "@/lib/server/replies";

/** POST /api/reply-drafts/:id/dismiss — don't reply to this comment. */
export const POST = handler(async (_request, context: RouteContext<"/api/reply-drafts/[id]/dismiss">) => {
  const { businessId, session } = await requireFeature("engagement.aiReplies");
  const { id } = await readParams(context, "id");
  await findPendingReply(businessId, id);
  const reply = await db.replyDraft.update({ where: { id }, data: { status: "DISMISSED", reviewedBy: session.userId }, select: REPLY_SELECT });
  await logActivity({ businessId, userId: session.userId, action: "reply.dismissed", details: { replyDraftId: id } });
  return ok(toReply(reply));
});
