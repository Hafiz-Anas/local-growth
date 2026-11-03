import type { L } from "@/mock-data/gallery/types";

/**
 * AI tab actions (AI4), the parts the browser and the server share: what an action card shows and the
 * question check that sends "do something" requests to the AI. Pure (no server-only, no React) so the
 * tests import it. The server decides and runs actions (lib/server/chat-actions.ts); the card is drawn by
 * components/ai-chat/action-card.tsx.
 */

export const CHAT_ACTION_TYPES = ["save_draft", "schedule", "post_now", "reschedule", "cancel"] as const;
export type ChatActionType = (typeof CHAT_ACTION_TYPES)[number];
/** Actions that change what goes out on Instagram: they wait for the owner's Approve. */
export const INSTAGRAM_ACTIONS: readonly ChatActionType[] = ["schedule", "post_now", "reschedule", "cancel"];
export const needsApproval = (type: ChatActionType) => INSTAGRAM_ACTIONS.includes(type);

export type ChatActionStatus = "proposed" | "running" | "done" | "failed" | "expired" | "cancelled";

/** A step the server actually did (or is doing): drawn as a ticked line with its result. */
export interface ChatActionStep {
  key: "saveDraft" | "draftSaved" | "proposed" | "scheduling" | "scheduled" | "posting" | "sent" | "cancelling" | "cancelled" | "failed" | "expired" | "dismissed";
  state: "done" | "running" | "failed";
  /** ISO time the step is about (e.g. "Scheduled for …"). */
  at?: string | null;
}

/** An action card in the chat (AiMsg kind "action"), as the server saved it. */
export interface ChatActionView {
  /** The AiChatAction row. */
  id: string;
  type: ChatActionType;
  status: ChatActionStatus;
  /** The time it's for (schedule / reschedule) and the time it had before (reschedule / cancel). */
  at?: string | null;
  previousAt?: string | null;
  /** The business's time zone: every time on the card is shown in it. */
  timeZone: string;
  /** Screen photo ids (the Gallery's) and the caption as it will be posted (EN + AR). */
  photoIds: string[];
  caption: L;
  draftId?: string | null;
  jobId?: string | null;
  /** Proposals only: Approve works until then. */
  expiresAt?: string | null;
  /** An error code (errors.<code> / galleryAi.actionError_<code>) when it failed. */
  error?: string | null;
  steps: ChatActionStep[];
}

/** How long a proposal can be approved. */
export const PROPOSAL_TTL_MS = 30 * 60 * 1000;

/** A proposal past its time can't be approved any more (the server checks it again). */
export const isExpired = (action: Pick<ChatActionView, "status" | "expiresAt">, now: number) =>
  action.status === "proposed" && !!action.expiresAt && Date.parse(action.expiresAt) <= now;

const ACTION_WORDS =
  /\b(schedule|reschedule|re-schedule|cancel|unschedule|post (it|this|that) now|publish|post now|move\b.{0,40}\b(post|it|this|that)\b|save (it|this|that|the (draft|post|caption))|(shorter|longer|change|edit|rewrite|update) .*\b(caption|hashtags?)\b|\b(caption|hashtags?)\b.*\b(shorter|longer|change|edit|rewrite|update)|delay|postpone)\b|جدول|جدولة|أجّل|أجل|اجل|ألغ|الغ|إلغاء|الغاء|انشر(ه|ها)? الآن|انشر(ه|ها)? الان|انقل|احفظ|غيّر الكابشن|غير الكابشن|اختصر|قصّر|قصر الكابشن/i;

/**
 * Whether the owner is asking the AI to do something to a post ("Schedule this for Friday at 8pm", "Cancel
 * tomorrow's post", "Make the caption shorter and save it"). Such questions always go to the AI, even when a
 * sample answer or a photo flow would otherwise take them.
 */
export function asksForAction(text: string): boolean {
  return ACTION_WORDS.test(text);
}
