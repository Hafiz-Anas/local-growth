import { requireAnyFeature } from "@/lib/server/guards";
import { handler, ok } from "@/lib/server/http";
import { replyKinds, replySummary } from "@/lib/server/replies";

/** GET /api/reply-drafts/summary — replies sent in the last 30 days by outcome, and whether Regenerate can work now. */
export const GET = handler(async () => {
  const { businessId, permissions } = await requireAnyFeature("engagement.aiReplies", "engagement.dmRules");
  return ok(await replySummary(businessId, replyKinds(permissions)));
});
