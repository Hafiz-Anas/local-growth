import { deleteChat, getChat, renameChat } from "@/lib/server/ai-chats";
import { requireFeature } from "@/lib/server/guards";
import { handler, ok, readJson, readParams } from "@/lib/server/http";
import { aiChatRenameSchema } from "@/lib/validation/api";

/** GET /api/ai-chats/:id — one chat with its messages (another business's chat: 404). */
export const GET = handler(async (_request, context: RouteContext<"/api/ai-chats/[id]">) => {
  const { businessId } = await requireFeature("aiChat");
  const { id } = await readParams(context, "id");
  return ok(await getChat(businessId, id));
});

/** PATCH /api/ai-chats/:id { title } — renames a chat. */
export const PATCH = handler(async (request, context: RouteContext<"/api/ai-chats/[id]">) => {
  const { businessId } = await requireFeature("aiChat");
  const { id } = await readParams(context, "id");
  const { title } = await readJson(request, aiChatRenameSchema);
  return ok(await renameChat(businessId, id, title));
});

/** DELETE /api/ai-chats/:id — deletes a chat and its messages. */
export const DELETE = handler(async (_request, context: RouteContext<"/api/ai-chats/[id]">) => {
  const { businessId } = await requireFeature("aiChat");
  const { id } = await readParams(context, "id");
  await deleteChat(businessId, id);
  return ok({ id });
});
