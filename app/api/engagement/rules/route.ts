import { db } from "@/lib/db";
import { logActivity } from "@/lib/server/activity";
import { listRules } from "@/lib/server/data";
import { RULE_SELECT, ruleData, toRule } from "@/lib/server/dto";
import { requireFeature } from "@/lib/server/guards";
import { handler, ok, readJson } from "@/lib/server/http";
import { createRuleSchema } from "@/lib/validation/api";

/** GET /api/engagement/rules — keyword reply rules (lib/server/keyword-replies.ts). */
export const GET = handler(async () => {
  const { businessId } = await requireFeature("engagement.dmRules");
  return ok(await listRules(businessId));
});

/** POST /api/engagement/rules  { keywords, commentReply, dmMessage?, matchType?, scope?, mediaIds?, autoSend?, active? } */
export const POST = handler(async (request) => {
  const { businessId, session } = await requireFeature("engagement.dmRules");
  const input = await readJson(request, createRuleSchema);
  const rule = await db.engagementRule.create({ data: { businessId, ...ruleData(input), mediaIds: input.scope === "selected" ? input.mediaIds : [] }, select: RULE_SELECT });
  await logActivity({ businessId, userId: session.userId, action: "dm_rule.created", details: { ruleId: rule.id, keywords: rule.keywords } });
  return ok(toRule(rule), { status: 201 });
});
