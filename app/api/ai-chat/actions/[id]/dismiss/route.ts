import { dismissChatAction } from "@/lib/server/chat-actions";
import { requireFeature } from "@/lib/server/guards";
import { handler, ok, readParams } from "@/lib/server/http";

/** POST /api/ai-chat/actions/:id/dismiss — "Not now" on an AI action card (AI4): nothing happens on Instagram. Answers `{ message }`. */
export const POST = handler(async (_request, context: RouteContext<"/api/ai-chat/actions/[id]/dismiss">) => {
  const { businessId, session } = await requireFeature("aiChat");
  const { id } = await readParams(context, "id");
  return ok({ message: await dismissChatAction(businessId, session.userId, id) });
});
