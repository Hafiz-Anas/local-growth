import { db } from "@/lib/db";
import { logActivity } from "@/lib/server/activity";
import { RULE_SELECT, toRule } from "@/lib/server/dto";
import { requireFeature } from "@/lib/server/guards";
import { handler, notFound, ok, readJson, readParams } from "@/lib/server/http";
import { updateRuleSchema } from "@/lib/validation/api";

async function assertOwnRule(businessId: string, id: string) {
  const exists = await db.engagementRule.count({ where: { id, businessId } });
  if (!exists) throw notFound("Rule");
}

/** PATCH /api/engagement/rules/:id  { keywords?, dmMessage?, active? } — edit, pause or activate. */
export const PATCH = handler(async (request, context: RouteContext<"/api/engagement/rules/[id]">) => {
  const { businessId, session } = await requireFeature("engagement.dmRules");
  const { id } = await readParams(context, "id");
  await assertOwnRule(businessId, id);
  const patch = await readJson(request, updateRuleSchema);
  const rule = await db.engagementRule.update({ where: { id }, data: patch, select: RULE_SELECT });
  const action = Object.keys(patch).length === 1 && patch.active !== undefined ? (patch.active ? "dm_rule.activated" : "dm_rule.paused") : "dm_rule.updated";
  await logActivity({ businessId, userId: session.userId, action, details: { ruleId: id } });
  return ok(toRule(rule));
});

/** DELETE /api/engagement/rules/:id */
export const DELETE = handler(async (_request, context: RouteContext<"/api/engagement/rules/[id]">) => {
  const { businessId, session } = await requireFeature("engagement.dmRules");
  const { id } = await readParams(context, "id");
  await assertOwnRule(businessId, id);
  await db.engagementRule.delete({ where: { id } });
  await logActivity({ businessId, userId: session.userId, action: "dm_rule.deleted", details: { ruleId: id } });
  return ok({ deleted: true });
});
