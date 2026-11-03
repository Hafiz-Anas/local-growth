import "server-only";
import { Prisma } from "@/lib/generated/prisma/client";
import { sanitizeChatPayload } from "@/lib/ai-chat-links";
import { db } from "@/lib/db";
import type { StoredChatMessage } from "@/lib/services/text/ai-chat";
import type { AiChatDto, AiChatListDto, AiChatMessageDto, AiChatSummaryDto } from "@/types/api";
import { ApiError, notFound } from "./http";
import { isDemoBusiness } from "./gallery";

/**
 * The AI tab's saved chats (AI2), in the old assistant's tables (AssistantConversation / AssistantMessage).
 * Chats belong to the business — every login of it sees them on any device — and `userId` records who
 * started one. The browser makes the chat and message ids (`clientKey` / `clientId`); every lookup is by
 * (businessId, clientKey), so another business's chat is simply not found (404). Messages are stored as the
 * chat draws them (`payload`); `content` holds the text the AI may read back as history: the owner's question,
 * or an answer the server wrote itself (POST /api/ai-chat). Demo businesses get the sample chats once
 * (`Business.aiChatsSeededAt`); real businesses never. Image links other than our storage or Instagram's CDN are
 * dropped from every message stored and read (sanitizeChatPayload, lib/ai-chat-links.ts).
 */

export const MAX_CHATS = 50;
export const MAX_CHAT_MESSAGES = 200;

type Title = { en: string; ar: string };
export type ChatMessageInput = AiChatMessageDto;
export interface ChatInput {
  id: string;
  title: Title;
  at?: string;
  messages: ChatMessageInput[];
}

const SUMMARY_SELECT = { clientKey: true, title: true, titleAr: true, sample: true, updatedAt: true } satisfies Prisma.AssistantConversationSelect;
type SummaryRow = Prisma.AssistantConversationGetPayload<{ select: typeof SUMMARY_SELECT }>;

const toSummary = (row: SummaryRow): AiChatSummaryDto => ({
  id: row.clientKey!,
  title: { en: row.title, ar: row.titleAr ?? row.title },
  at: row.updatedAt.toISOString(),
  sample: row.sample,
});

const titleColumns = (title: Title) => ({ title: title.en.slice(0, 120), titleAr: title.ar && title.ar !== title.en ? title.ar.slice(0, 120) : null });

/** The language a message is in, and the text the AI may read back: only the owner's own words here. */
function messageRow(m: ChatMessageInput) {
  const text = m.role === "user" && m.text && typeof m.text === "object" ? (m.text as { en?: unknown }).en : "";
  const content = typeof text === "string" ? text : "";
  return { clientId: m.id, role: m.role === "user" ? ("USER" as const) : ("ASSISTANT" as const), content, language: /[؀-ۿ]/.test(content) ? "ar" : "en", payload: sanitizeChatPayload(m) as unknown as Prisma.InputJsonValue };
}

async function conversation(businessId: string, key: string) {
  const row = await db.assistantConversation.findUnique({ where: { businessId_clientKey: { businessId, clientKey: key } }, select: { id: true } });
  if (!row) throw notFound("Chat");
  return row;
}

/** Action cards (AI4) are written by the server only (lib/server/chat-actions.ts). */
function assertNoActionCards(messages: ChatMessageInput[]) {
  if (messages.some((m) => m.kind === "action")) throw new ApiError(400, "validation_error", "Action cards are written by the server.");
}

/** The business's chats, most recent first; `sampleDue`: a demo business that hasn't had its sample chats yet. */
export async function listChats(businessId: string): Promise<AiChatListDto> {
  const [rows, business, demo] = await Promise.all([
    db.assistantConversation.findMany({ where: { businessId, clientKey: { not: null } }, orderBy: { updatedAt: "desc" }, take: MAX_CHATS, select: SUMMARY_SELECT }),
    db.business.findUniqueOrThrow({ where: { id: businessId }, select: { aiChatsSeededAt: true } }),
    isDemoBusiness(businessId),
  ]);
  return { chats: rows.map(toSummary), sampleDue: demo && !business.aiChatsSeededAt };
}

/** One chat with its messages, oldest first. */
export async function getChat(businessId: string, key: string): Promise<AiChatDto> {
  const row = await db.assistantConversation.findUnique({
    where: { businessId_clientKey: { businessId, clientKey: key } },
    select: { ...SUMMARY_SELECT, messages: { orderBy: { createdAt: "asc" }, take: MAX_CHAT_MESSAGES, select: { payload: true } } },
  });
  if (!row) throw notFound("Chat");
  return { ...toSummary(row), messages: row.messages.map((m) => sanitizeChatPayload(m.payload as unknown as AiChatMessageDto)).filter(Boolean) };
}

/** Adds messages to a chat; ones already stored (same id) are left as they are. */
async function addMessages(conversationId: string, messages: ChatMessageInput[], at?: Date) {
  if (!messages.length) return;
  const base = (at ?? new Date()).getTime();
  // createdAt keeps the order they were sent in (one millisecond apart).
  await db.assistantMessage.createMany({
    data: messages.map((m, i) => ({ conversationId, createdAt: new Date(base + i), ...messageRow(m) })),
    skipDuplicates: true,
  });
}

/** A new chat with its first messages; sending the same chat again only adds the messages it doesn't have. */
export async function createChat(businessId: string, userId: string | null, input: ChatInput, options: { sample?: boolean } = {}): Promise<AiChatSummaryDto> {
  assertNoActionCards(input.messages);
  const at = input.at ? new Date(input.at) : new Date();
  let row: SummaryRow & { id: string };
  try {
    row = await db.assistantConversation.create({
      data: { businessId, userId, clientKey: input.id, sample: options.sample ?? false, ...titleColumns(input.title), createdAt: at, updatedAt: at },
      select: { id: true, ...SUMMARY_SELECT },
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
    const existing = await db.assistantConversation.findUnique({ where: { businessId_clientKey: { businessId, clientKey: input.id } }, select: { id: true, ...SUMMARY_SELECT } });
    if (!existing) throw error;
    row = existing;
  }
  await addMessages(row.id, input.messages.slice(0, MAX_CHAT_MESSAGES), at);
  return toSummary(row);
}

/** Messages added to a chat (most recent activity: the chat moves to the top). */
export async function appendMessages(businessId: string, key: string, messages: ChatMessageInput[], options: { server?: boolean } = {}): Promise<void> {
  if (!options.server) assertNoActionCards(messages);
  const { id } = await conversation(businessId, key);
  if ((await db.assistantMessage.count({ where: { conversationId: id } })) + messages.length > MAX_CHAT_MESSAGES) throw new ApiError(409, "conflict", "This chat is full. Start a new chat.");
  await addMessages(id, messages);
  await db.assistantConversation.update({ where: { id }, data: { updatedAt: new Date() } });
}

/**
 * A message's new state (a post card that finished, a direction picked). The role and the text kept for the
 * AI don't change; only what the chat draws.
 */
export async function updateMessage(businessId: string, key: string, messageId: string, payload: ChatMessageInput, options: { server?: boolean } = {}): Promise<void> {
  if (!options.server) assertNoActionCards([payload]);
  const { id } = await conversation(businessId, key);
  const row = await db.assistantMessage.findUnique({ where: { conversationId_clientId: { conversationId: id, clientId: messageId } }, select: { id: true, role: true, payload: true } });
  if (!row) throw notFound("Message");
  // An action card (AI4) is the server's record of what the AI did: the browser can't overwrite it.
  if (!options.server && (row.payload as { kind?: unknown } | null)?.kind === "action") throw new ApiError(409, "conflict", "This message can't be changed.");
  if ((row.role === "USER") !== (payload.role === "user") || payload.id !== messageId) throw new ApiError(400, "validation_error", "A message's id and role can't change.");
  await db.assistantMessage.update({ where: { id: row.id }, data: { payload: sanitizeChatPayload(payload) as unknown as Prisma.InputJsonValue } });
}

export async function renameChat(businessId: string, key: string, title: string): Promise<AiChatSummaryDto> {
  const { id } = await conversation(businessId, key);
  // Renaming isn't activity: the chat keeps its place in the list.
  const current = await db.assistantConversation.findUniqueOrThrow({ where: { id }, select: { updatedAt: true } });
  return toSummary(await db.assistantConversation.update({ where: { id }, data: { title, titleAr: null, updatedAt: current.updatedAt }, select: SUMMARY_SELECT }));
}

export async function deleteChat(businessId: string, key: string): Promise<void> {
  const { count } = await db.assistantConversation.deleteMany({ where: { businessId, clientKey: key } });
  if (!count) throw notFound("Chat");
}

/**
 * Chats from this browser's old localStorage list, or (`sample`) a demo business's sample chats. Importing is
 * safe to repeat: chats already stored are kept as they are. Sample chats are added once per demo business
 * (claimed atomically, so two tabs don't both add them) and never for a real business (404).
 */
export async function importChats(businessId: string, userId: string | null, chats: ChatInput[], { sample = false }: { sample?: boolean } = {}): Promise<{ imported: number }> {
  if (sample) {
    if (!(await isDemoBusiness(businessId))) throw notFound();
    const claim = await db.business.updateMany({ where: { id: businessId, aiChatsSeededAt: null }, data: { aiChatsSeededAt: new Date() } });
    if (!claim.count) return { imported: 0 };
  }
  const room = MAX_CHATS - (await db.assistantConversation.count({ where: { businessId } }));
  const existing = new Set(
    (await db.assistantConversation.findMany({ where: { businessId, clientKey: { in: chats.map((c) => c.id) } }, select: { clientKey: true } })).map((c) => c.clientKey),
  );
  const fresh = chats.filter((c) => !existing.has(c.id)).slice(0, Math.max(0, room));
  for (const chat of fresh) await createChat(businessId, userId, chat, { sample });
  return { imported: fresh.length };
}

/** The stored messages of a chat, oldest first, as history for the AI (chatHistory); 404 for another business's chat. */
export async function chatMessagesForAi(businessId: string, key: string, limit: number): Promise<{ conversationId: string; messages: StoredChatMessage[] }> {
  const { id } = await conversation(businessId, key);
  const rows = await db.assistantMessage.findMany({ where: { conversationId: id }, orderBy: { createdAt: "desc" }, take: limit, select: { role: true, content: true, payload: true } });
  return { conversationId: id, messages: rows.reverse() };
}

/** Stores an answer the server wrote (POST /api/ai-chat): its text is what the AI reads back later. */
export async function saveAnswer(conversationId: string, message: { id: string; text: string; sample: boolean }): Promise<AiChatMessageDto> {
  const payload: AiChatMessageDto = { id: message.id, role: "ai", kind: "text", text: { en: message.text, ar: message.text }, ...(message.sample ? { sample: true } : {}) };
  await db.assistantMessage.createMany({
    data: [{ conversationId, clientId: message.id, role: "ASSISTANT", content: message.text, language: /[؀-ۿ]/.test(message.text) ? "ar" : "en", payload: payload as unknown as Prisma.InputJsonValue }],
    skipDuplicates: true,
  });
  await db.assistantConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
  return payload;
}
