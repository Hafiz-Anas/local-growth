import { db } from "@/lib/db";
import { replyProblem } from "@/lib/replies";
import { REPLY_SELECT, toReply } from "@/lib/server/dto";
import { requireAnyFeature } from "@/lib/server/guards";
import { ApiError, handler, ok, readJson, readParams } from "@/lib/server/http";
import { assertReplyKind, findPendingReply } from "@/lib/server/replies";
import { editReplySchema } from "@/lib/validation/api";

/** PATCH /api/reply-drafts/:id  { draftReply } — save an edit without sending (aiReply keeps the AI's text). */
export const PATCH = handler(async (request, context: RouteContext<"/api/reply-drafts/[id]">) => {
  const { businessId, permissions } = await requireAnyFeature("engagement.aiReplies", "engagement.dmRules");
  const { id } = await readParams(context, "id");
  const pending = await findPendingReply(businessId, id);
  assertReplyKind(permissions, pending);
  const { draftReply } = await readJson(request, editReplySchema);
  const problem = replyProblem(draftReply, pending.channel === "DM" ? "dm" : "comment");
  if (problem) throw new ApiError(422, "reply_invalid", `Instagram wouldn't accept this reply (${problem}).`, [{ path: "reason", message: problem }]);
  const reply = await db.replyDraft.update({ where: { id }, data: { draftReply }, select: REPLY_SELECT });
  return ok(toReply(reply));
});
