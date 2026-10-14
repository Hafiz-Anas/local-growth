import { askAssistant } from "@/lib/server/assistant";
import { requireFeature } from "@/lib/server/guards";
import { handler, ok, readJson } from "@/lib/server/http";
import { assistantMessageSchema } from "@/lib/validation/api";

/**
 * POST /api/assistant/messages  { conversationId?, mode, text } — ask the AI assistant.
 * 201 with the saved question and answer; 503 assistant_unavailable (with the reason)
 * when the AI can't answer, in which case nothing is saved; 429 assistant_limit.
 */
export const POST = handler(async (request) => {
  const { businessId, session, permissions } = await requireFeature("assistant");
  const input = await readJson(request, assistantMessageSchema);
  return ok(await askAssistant({ businessId, userId: session.userId, permissions }, input), { status: 201 });
});
