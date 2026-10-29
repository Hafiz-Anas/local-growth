import type { ChatMode } from "@/mock-data/gallery/ai-chat";
import type { AiChat, AiMsg } from "@/mock-data/gallery/ai-studio";

/*
 * AI chats are kept in this browser, one list per business, like saved inspiration
 * (lib/gallery/competitor-posts.ts). Never sent to the server. Pure, so it can be unit-tested.
 */

export const chatsStorageKey = (businessId: string) => `lge_ai_chats:${businessId}`;
export const MAX_SAVED_CHATS = 50;

export const CHAT_MODES: ChatMode[] = ["post", "analytics", "competitors"];

const isText = (x: unknown): x is { en: string; ar: string } => !!x && typeof x === "object" && typeof (x as { en: unknown }).en === "string" && typeof (x as { ar: unknown }).ar === "string";

function isMessage(x: unknown): x is AiMsg {
  if (!x || typeof x !== "object") return false;
  const m = x as { id?: unknown; role?: unknown; kind?: unknown; text?: unknown };
  if (typeof m.id !== "string") return false;
  if (m.role === "user") return isText(m.text);
  return m.role === "ai" && typeof m.kind === "string";
}

/**
 * The stored chats, keeping only well-formed ones; anything unreadable is an empty list.
 * Answers that were still "working" when the page closed show as finished.
 */
export function parseSavedChats(raw: string | null): AiChat[] {
  if (!raw) return [];
  try {
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list
      .filter(
        (c): c is AiChat =>
          !!c &&
          typeof c === "object" &&
          typeof c.id === "string" &&
          isText(c.title) &&
          CHAT_MODES.includes(c.mode) &&
          typeof c.at === "string" &&
          !Number.isNaN(Date.parse(c.at)) &&
          Array.isArray(c.messages),
      )
      .map((c) => ({ ...c, messages: c.messages.filter(isMessage).map((m) => ("ready" in m && !m.ready ? { ...m, ready: true } : m)) }))
      .slice(0, MAX_SAVED_CHATS);
  } catch {
    return [];
  }
}

export type ChatGroup = "today" | "yesterday" | "earlier";

/** Today / Yesterday / Earlier, by calendar day in this browser's time zone. */
export function chatGroup(at: string, now: Date): ChatGroup {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((day(now) - day(new Date(at))) / 86_400_000);
  return diff <= 0 ? "today" : diff === 1 ? "yesterday" : "earlier";
}

/** Chats in their groups, newest first, leaving out empty groups. */
export function groupChats(chats: AiChat[], now: Date): { group: ChatGroup; chats: AiChat[] }[] {
  const sorted = [...chats].sort((a, b) => b.at.localeCompare(a.at));
  return (["today", "yesterday", "earlier"] as const)
    .map((group) => ({ group, chats: sorted.filter((c) => chatGroup(c.at, now) === group) }))
    .filter((g) => g.chats.length > 0);
}

/** The sample chats, moved so they sit as far before `now` as they sit before the demo clock. */
export function shiftChats(chats: AiChat[], demoNow: Date, now: Date): AiChat[] {
  const offset = now.getTime() - demoNow.getTime();
  return chats.map((c) => ({ ...c, at: new Date(Date.parse(c.at) + offset).toISOString() }));
}
