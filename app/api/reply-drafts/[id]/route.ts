import { db } from "@/lib/db";
import { REPLY_SELECT, toReply } from "@/lib/server/dto";
import { requireFeature } from "@/lib/server/guards";
import { handler, ok, readJson, readParams } from "@/lib/server/http";
import { findPendingReply } from "@/lib/server/replies";
import { editReplySchema } from "@/lib/validation/api";

/** PATCH /api/reply-drafts/:id  { draftReply } — edit the AI draft before approving. */
export const PATCH = handler(async (request, context: RouteContext<"/api/reply-drafts/[id]">) => {
  const { businessId } = await requireFeature("engagement.aiReplies");
  const { id } = await readParams(context, "id");
  await findPendingReply(businessId, id);
  const { draftReply } = await readJson(request, editReplySchema);
  const reply = await db.replyDraft.update({ where: { id }, data: { draftReply }, select: REPLY_SELECT });
  return ok(toReply(reply));
});
