import { db } from "@/lib/db";
import { logActivity } from "@/lib/server/activity";
import { RULE_SELECT, ruleData, toRule } from "@/lib/server/dto";
import { requireFeature } from "@/lib/server/guards";
import { ApiError, handler, notFound, ok, readJson, readParams } from "@/lib/server/http";
import { updateRuleSchema } from "@/lib/validation/api";

async function findOwnRule(businessId: string, id: string) {
  const rule = await db.engagementRule.findFirst({ where: { id, businessId }, select: { commentReply: true, dmMessage: true, scope: true, mediaIds: true } });
  if (!rule) throw notFound("Rule");
  return rule;
}

const invalid = (path: string, message: string) => new ApiError(400, "validation_error", message, [{ path, message }]);

/** PATCH /api/engagement/rules/:id  (any rule field) — edit, pause or activate. */
export const PATCH = handler(async (request, context: RouteContext<"/api/engagement/rules/[id]">) => {
  const { businessId, session } = await requireFeature("engagement.dmRules");
  const { id } = await readParams(context, "id");
  const current = await findOwnRule(businessId, id);
  const patch = await readJson(request, updateRuleSchema);

  // The rule as it will be after the patch must still make sense (older rules may have no public reply).
  const commentReply = patch.commentReply ?? current.commentReply;
  const selected = (patch.scope ?? (current.scope === "SELECTED_POSTS" ? "selected" : "all")) === "selected";
  const mediaIds = patch.mediaIds ?? current.mediaIds;
  // Rules made before keyword replies may have only a DM; they stay valid (and need approval) until a reply is added.
  if (!commentReply && !(patch.dmMessage ?? current.dmMessage)) throw invalid("commentReply", "Add a public reply.");
  if (selected && !mediaIds.length) throw invalid("mediaIds", "Pick at least one post.");

  const rule = await db.engagementRule.update({ where: { id }, data: { ...ruleData(patch), ...(!selected && patch.scope && { mediaIds: [] }) }, select: RULE_SELECT });
  const action = Object.keys(patch).length === 1 && patch.active !== undefined ? (patch.active ? "dm_rule.activated" : "dm_rule.paused") : "dm_rule.updated";
  await logActivity({ businessId, userId: session.userId, action, details: { ruleId: id } });
  return ok(toRule(rule));
});

/** DELETE /api/engagement/rules/:id — its replies still waiting for approval are dismissed too. */
export const DELETE = handler(async (_request, context: RouteContext<"/api/engagement/rules/[id]">) => {
  const { businessId, session } = await requireFeature("engagement.dmRules");
  const { id } = await readParams(context, "id");
  await findOwnRule(businessId, id);
  await db.$transaction([
    db.replyDraft.updateMany({ where: { businessId, ruleId: id, status: "PENDING" }, data: { status: "DISMISSED" } }),
    db.keywordReplyTrigger.updateMany({ where: { businessId, ruleId: id, status: "AWAITING_APPROVAL" }, data: { status: "DISMISSED" } }),
    db.engagementRule.delete({ where: { id } }),
  ]);
  await logActivity({ businessId, userId: session.userId, action: "dm_rule.deleted", details: { ruleId: id } });
  return ok({ deleted: true });
});
