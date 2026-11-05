import { db } from "@/lib/db";
import { chatMessagesForAi, saveAnswer } from "@/lib/server/ai-chats";
import { actionContext, allowedActionTypes, runChatAction, saveAsk, type ActionContext } from "@/lib/server/chat-actions";
import { chatFacts } from "@/lib/server/chat-facts";
import { isDemoBusiness } from "@/lib/server/gallery";
import { requireFeature } from "@/lib/server/guards";
import { ApiError, handler, ok, readJson } from "@/lib/server/http";
import { AI_CHAT_LIMIT, getRateLimiter } from "@/lib/server/rate-limit";
import { getAIService } from "@/lib/services/ai";
import { CHAT_HISTORY_LIMIT, chatHistory, chatTopics, questionLanguage, summarizeMessage, type StoredChatMessage } from "@/lib/services/text/ai-chat";
import { decideAction, postRefLines, todayLine } from "@/lib/services/text/chat-actions";
import { aiChatSchema } from "@/lib/validation/api";
import type { AiChatAnswerDto } from "@/types/api";

/**
 * POST /api/ai-chat { question, chatId?, answerId?, photoIds? } — a question asked in the AI tab (AI3, AI4). The AI
 * answers from the business facts (lib/server/chat-facts.ts: only the sections the question needs) and the chat's
 * earlier turns, read from the database (the question itself was saved in the chat first). Sentences stating a
 * number that isn't in the facts are dropped (checkChatNumbers); the answer is saved in the chat and returned.
 *
 * The same single AI call may carry an action (AI4: save a draft, schedule, post now, reschedule, cancel — only the
 * ones this business has switched on) on one of the posts listed for it (this chat's post cards, upcoming posts).
 * Code checks it (lib/services/text/chat-actions.ts): an unclear post or time becomes a question back; a draft is
 * saved at once; anything for Instagram becomes an action card waiting for Approve (lib/server/chat-actions.ts).
 *
 * `text` is null when the AI is off, over its budget (AI_CHAT_LIMIT per business, plus the text request gate), failed
 * or invented most of its numbers: nothing is saved and the chat shows its fallback (components/ai-chat/engine.ts).
 * Another business's chat: 404.
 */
export const POST = handler(async (request) => {
  const { businessId, permissions, session } = await requireFeature("aiChat");
  const { question, chatId, answerId, photoIds = [] } = await readJson(request, aiChatSchema);
  const stored = chatId ? await chatMessagesForAi(businessId, chatId, CHAT_HISTORY_LIMIT + 1) : null;
  const none: AiChatAnswerDto = { text: null, message: null };
  const ai = getAIService();
  if (!(await ai.textAvailability(businessId)).available || !(await getRateLimiter().consume(AI_CHAT_LIMIT, businessId))) return ok(none);

  // The question was saved in the chat just before: the history is what came before it.
  const before: StoredChatMessage[] = [...(stored?.messages ?? [])];
  if (before.at(-1)?.role === "USER") before.pop();
  const previousQuestion = before.filter((m) => m.role === "USER").at(-1);

  const now = Date.now();
  // Actions need a saved chat (the action card lives in it) and the answer's id.
  const ctx: ActionContext | null = chatId && answerId ? await actionContext(businessId, chatId, now) : null;
  const types = ctx ? allowedActionTypes(permissions) : [];
  const language = questionLanguage(question);

  const [business, demo] = await Promise.all([db.business.findUniqueOrThrow({ where: { id: businessId }, select: { name: true, nameAr: true } }), isDemoBusiness(businessId)]);
  const facts = await chatFacts(businessId, permissions, chatTopics(question, previousQuestion ? summarizeMessage(previousQuestion) : null));
  const answer = await ai.chatReply({
    businessId,
    prompt: {
      language,
      businessName: business.name,
      businessNameAr: business.nameAr,
      question,
      facts,
      history: chatHistory(before),
      demo,
      actions: { types, today: todayLine(now, ctx?.timeZone ?? "Asia/Kuwait"), posts: ctx ? postRefLines(ctx.refs, ctx.timeZone, now) : [], attachedPhotos: photoIds.length },
    },
  });
  if (!answer.ok) return ok(none);

  if (answer.action && ctx && stored && answerId) {
    const decision = decideAction(answer.action, ctx.refs, { timeZone: ctx.timeZone, now, attachedPhotos: photoIds.length, question });
    if (decision.kind === "ask") {
      // The AI's own question when it asked one, else the app's (which post / what time / which photo).
      const message = answer.ask ? await saveAnswer(stored.conversationId, { id: answerId, text: answer.ask, sample: false }) : await saveAsk(businessId, ctx, answerId, decision.reason, language);
      return ok<AiChatAnswerDto>({ text: answer.ask ?? message.text?.[language] ?? null, message });
    }
    try {
      const question = await db.assistantMessage.findFirst({ where: { conversationId: ctx.conversationId, role: "USER" }, orderBy: { createdAt: "desc" }, select: { clientId: true } });
      const result = await runChatAction({ businessId, userId: session.userId, permissions, ctx, decision, messageId: answerId, questionId: question?.clientId ?? null, attachedPhotoIds: photoIds, language });
      return ok<AiChatAnswerDto>({ text: null, message: result.message, updated: result.updated });
    } catch (error) {
      // A post or photo that isn't there any more, or a draft that can't change now: say so instead of a fallback.
      if (!(error instanceof ApiError) || error.status >= 500) throw error;
      console.warn(`[ai-chat] action ${decision.kind === "save" ? "save_draft" : decision.type} refused: ${error.code} (${error.message})`);
      const message = await saveAsk(businessId, ctx, answerId, error.code === "already_scheduled" ? "photo_locked" : error.code === "publish_started" ? "publishing" : error.code === "not_found" ? "no_post" : "failed", language);
      return ok<AiChatAnswerDto>({ text: message.text?.[language] ?? null, message });
    }
  }

  const text = [answer.text, answer.ask].filter(Boolean).join("\n\n");
  if (!text) return ok(none);
  const message = stored && answerId ? await saveAnswer(stored.conversationId, { id: answerId, text, sample: demo }) : null;
  return ok<AiChatAnswerDto>({ text, message });
});
