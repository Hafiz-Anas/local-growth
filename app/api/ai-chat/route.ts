import { db } from "@/lib/db";
import { requireFeature } from "@/lib/server/guards";
import { handler, ok, readJson } from "@/lib/server/http";
import { AI_CHAT_LIMIT, getRateLimiter } from "@/lib/server/rate-limit";
import { getAIService } from "@/lib/services/ai";
import { questionLanguage } from "@/lib/services/text/ai-chat";
import { aiChatSchema } from "@/lib/validation/api";

/**
 * POST /api/ai-chat — a question typed in the AI tab that none of its sample answers matches.
 * `{ text }` is a short general reply from the AI, or null when the AI is off, over its budget
 * (AI_CHAT_LIMIT per business, plus the text request gate) or failed: the chat then shows its
 * sample answer (components/ai-chat/engine.ts). Nothing is stored.
 */
export const POST = handler(async (request) => {
  const { businessId } = await requireFeature("aiChat");
  const { question } = await readJson(request, aiChatSchema);
  const ai = getAIService();
  if (!ai.textAvailability().available || !(await getRateLimiter().consume(AI_CHAT_LIMIT, businessId))) return ok({ text: null });

  const business = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { name: true, nameAr: true } });
  const answer = await ai.chatReply({
    businessId,
    prompt: { language: questionLanguage(question), businessName: business.name, businessNameAr: business.nameAr, question },
  });
  return ok({ text: answer.ok ? answer.text : null });
});
