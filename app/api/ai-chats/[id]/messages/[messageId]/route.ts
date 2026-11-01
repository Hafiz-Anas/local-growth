import { updateMessage } from "@/lib/server/ai-chats";
import { requireFeature } from "@/lib/server/guards";
import { handler, ok, readJson, readParams } from "@/lib/server/http";
import { aiChatMessageUpdateSchema } from "@/lib/validation/api";

/** PATCH /api/ai-chats/:id/messages/:messageId { message } — a message's new state (a post card finished, a direction picked). */
export const PATCH = handler(async (request, context: RouteContext<"/api/ai-chats/[id]/messages/[messageId]">) => {
  const { businessId } = await requireFeature("aiChat");
  const { id, messageId } = await readParams(context, "id", "messageId");
  const { message } = await readJson(request, aiChatMessageUpdateSchema);
  await updateMessage(businessId, id, messageId, message);
  return ok({ id: messageId });
});
