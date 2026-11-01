import { db } from "@/lib/db";
import { chatMessagesForAi, saveAnswer } from "@/lib/server/ai-chats";
import { chatFacts } from "@/lib/server/chat-facts";
import { isDemoBusiness } from "@/lib/server/gallery";
import { requireFeature } from "@/lib/server/guards";
import { handler, ok, readJson } from "@/lib/server/http";
import { AI_CHAT_LIMIT, getRateLimiter } from "@/lib/server/rate-limit";
import { getAIService } from "@/lib/services/ai";
import { CHAT_HISTORY_LIMIT, chatHistory, chatTopics, questionLanguage, summarizeMessage, type StoredChatMessage } from "@/lib/services/text/ai-chat";
import { aiChatSchema } from "@/lib/validation/api";
import type { AiChatAnswerDto } from "@/types/api";

/**
 * POST /api/ai-chat { question, chatId?, answerId? } — a question asked in the AI tab (AI3). The AI answers from
 * the business facts (lib/server/chat-facts.ts: only the sections the question needs) and the chat's earlier
 * turns, read from the database (the question itself was saved in the chat first). Sentences stating a number
 * that isn't in the facts are dropped (checkChatNumbers); the answer is saved in the chat and returned. `text`
 * is null when the AI is off, over its budget (AI_CHAT_LIMIT per business, plus the text request gate), failed
 * or invented most of its numbers: nothing is saved and the chat shows its fallback (components/ai-chat/engine.ts).
 * Another business's chat: 404.
 */
export const POST = handler(async (request) => {
  const { businessId, permissions } = await requireFeature("aiChat");
  const { question, chatId, answerId } = await readJson(request, aiChatSchema);
  const stored = chatId ? await chatMessagesForAi(businessId, chatId, CHAT_HISTORY_LIMIT + 1) : null;
  const none: AiChatAnswerDto = { text: null, message: null };
  const ai = getAIService();
  if (!ai.textAvailability().available || !(await getRateLimiter().consume(AI_CHAT_LIMIT, businessId))) return ok(none);

  // The question was saved in the chat just before: the history is what came before it.
  const before: StoredChatMessage[] = [...(stored?.messages ?? [])];
  if (before.at(-1)?.role === "USER") before.pop();
  const previousQuestion = before.filter((m) => m.role === "USER").at(-1);

  const [business, demo] = await Promise.all([db.business.findUniqueOrThrow({ where: { id: businessId }, select: { name: true, nameAr: true } }), isDemoBusiness(businessId)]);
  const facts = await chatFacts(businessId, permissions, chatTopics(question, previousQuestion ? summarizeMessage(previousQuestion) : null));
  const answer = await ai.chatReply({
    businessId,
    prompt: { language: questionLanguage(question), businessName: business.name, businessNameAr: business.nameAr, question, facts, history: chatHistory(before), demo },
  });
  if (!answer.ok) return ok(none);
  const message = stored && answerId ? await saveAnswer(stored.conversationId, { id: answerId, text: answer.text, sample: demo }) : null;
  return ok<AiChatAnswerDto>({ text: answer.text, message });
});
