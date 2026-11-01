import { createChat, listChats } from "@/lib/server/ai-chats";
import { requireFeature } from "@/lib/server/guards";
import { handler, ok, readJson } from "@/lib/server/http";
import { aiChatCreateSchema } from "@/lib/validation/api";

/** GET /api/ai-chats — the business's AI tab chats, most recent first (titles only; messages per chat). */
export const GET = handler(async () => {
  const { businessId } = await requireFeature("aiChat");
  return ok(await listChats(businessId));
});

/** POST /api/ai-chats { id, title, messages } — a new chat (sending it again only adds missing messages). */
export const POST = handler(async (request) => {
  const { businessId, session } = await requireFeature("aiChat");
  const input = await readJson(request, aiChatCreateSchema);
  return ok(await createChat(businessId, session.userId, input), { status: 201 });
});
