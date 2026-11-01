"use client";

import { apiFetch } from "@/lib/api/client";
import type { AiChat, AiMsg } from "@/mock-data/gallery/ai-studio";
import type { AiChatAnswerDto, AiChatDto, AiChatListDto, AiChatMessageDto, AiChatSummaryDto } from "@/types/api";

/**
 * The AI tab's saved chats (app/api/ai-chats): chats belong to the business and open on any device. In admin
 * preview (`previewBusinessId`) only the read-only copies are read.
 */

type Both = { en: string; ar: string };
const TITLE_MAX = 120;
const title = (t: Both): Both => ({ en: t.en.slice(0, TITLE_MAX) || "New chat", ar: (t.ar || t.en).slice(0, TITLE_MAX) || "محادثة جديدة" });
const base = (previewBusinessId?: string) => (previewBusinessId ? `/api/admin/preview/${previewBusinessId}/ai-chats` : "/api/ai-chats");
const asDto = (m: AiMsg) => m as unknown as AiChatMessageDto;
/** Old local chats are sent a few at a time. */
const IMPORT_BATCH = 5;

export const chatsApi = {
  list: (previewBusinessId?: string) => apiFetch<AiChatListDto>(base(previewBusinessId)),
  get: (id: string, previewBusinessId?: string) => apiFetch<AiChatDto>(`${base(previewBusinessId)}/${id}`),
  create: (chat: { id: string; title: Both; messages: AiMsg[] }) =>
    apiFetch<AiChatSummaryDto>("/api/ai-chats", { method: "POST", body: { id: chat.id, title: title(chat.title), messages: chat.messages.map(asDto) } }),
  append: (id: string, messages: AiMsg[]) => apiFetch(`/api/ai-chats/${id}/messages`, { method: "POST", body: { messages: messages.map(asDto) } }),
  update: (id: string, message: AiMsg) => apiFetch(`/api/ai-chats/${id}/messages/${message.id}`, { method: "PATCH", body: { message: asDto(message) } }),
  rename: (id: string, name: string) => apiFetch<AiChatSummaryDto>(`/api/ai-chats/${id}`, { method: "PATCH", body: { title: name.slice(0, TITLE_MAX) } }),
  remove: (id: string) => apiFetch(`/api/ai-chats/${id}`, { method: "DELETE" }),
  /** Chats kept in this browser before (or a demo's sample chats, `sample`): sent once, a few at a time. */
  async import(chats: AiChat[], sample = false): Promise<number> {
    let imported = 0;
    const body = (list: AiChat[]) => ({ sample, chats: list.map((c) => ({ id: c.id, title: title(c.title), at: c.at, messages: c.messages.map(asDto) })) });
    // The sample chats are claimed once per business: they go in one request.
    if (sample) return (await apiFetch<{ imported: number }>("/api/ai-chats/import", { method: "POST", body: body(chats) })).imported;
    for (let i = 0; i < chats.length; i += IMPORT_BATCH) {
      imported += (await apiFetch<{ imported: number }>("/api/ai-chats/import", { method: "POST", body: body(chats.slice(i, i + IMPORT_BATCH)) })).imported;
    }
    return imported;
  },
  ask: (body: { question: string; chatId?: string; answerId?: string }) => apiFetch<AiChatAnswerDto>("/api/ai-chat", { method: "POST", body }),
};
