import { deleteAssistantConversation, getAssistantThread } from "@/lib/server/assistant";
import { requireFeature } from "@/lib/server/guards";
import { handler, ok, readParams } from "@/lib/server/http";

/** GET /api/assistant/conversations/:id — one chat of the caller's business, oldest message first. */
export const GET = handler(async (_request, context: RouteContext<"/api/assistant/conversations/[id]">) => {
  const { businessId } = await requireFeature("assistant");
  const { id } = await readParams(context, "id");
  return ok(await getAssistantThread(businessId, id));
});

/** DELETE /api/assistant/conversations/:id — delete a chat and its messages. */
export const DELETE = handler(async (_request, context: RouteContext<"/api/assistant/conversations/[id]">) => {
  const { businessId } = await requireFeature("assistant");
  const { id } = await readParams(context, "id");
  await deleteAssistantConversation(businessId, id);
  return ok({ id });
});
