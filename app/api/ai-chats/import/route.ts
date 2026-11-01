import { importChats } from "@/lib/server/ai-chats";
import { requireFeature } from "@/lib/server/guards";
import { handler, ok, readJson } from "@/lib/server/http";
import { aiChatImportSchema } from "@/lib/validation/api";

/**
 * POST /api/ai-chats/import { chats, sample? } — the chats this browser kept in localStorage before chats were
 * saved here (once; chats already stored are kept), or a demo business's sample chats (once per business).
 */
export const POST = handler(async (request) => {
  const { businessId, session } = await requireFeature("aiChat");
  const { chats, sample } = await readJson(request, aiChatImportSchema);
  return ok(await importChats(businessId, session.userId, chats, { sample }));
});
