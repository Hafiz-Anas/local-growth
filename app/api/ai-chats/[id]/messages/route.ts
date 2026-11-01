import { appendMessages } from "@/lib/server/ai-chats";
import { requireFeature } from "@/lib/server/guards";
import { handler, ok, readJson, readParams } from "@/lib/server/http";
import { aiChatMessagesSchema } from "@/lib/validation/api";

/** POST /api/ai-chats/:id/messages { messages } — messages the chat added (questions, post cards, sample answers). */
export const POST = handler(async (request, context: RouteContext<"/api/ai-chats/[id]/messages">) => {
  const { businessId } = await requireFeature("aiChat");
  const { id } = await readParams(context, "id");
  const { messages } = await readJson(request, aiChatMessagesSchema);
  await appendMessages(businessId, id, messages);
  return ok({ id }, { status: 201 });
});
