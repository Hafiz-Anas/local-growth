import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { PROPOSAL_TTL_MS, type ChatActionStatus, type ChatActionStep, type ChatActionType, type ChatActionView } from "@/lib/gallery/chat-actions";
import { translate, type MessageKey } from "@/lib/gallery/i18n";
import { parsePhotoRef, samplePhotoId } from "@/lib/gallery/refs";
import { isFeatureEnabled } from "@/lib/permissions";
import { ACTION_CARDS_MAX, ACTION_UPCOMING_MAX, type ActionDecision, type AskReason, type ChatPostRef, type PostRefStatus } from "@/lib/services/text/chat-actions";
import type { Permissions } from "@/types";
import type { AiChatMessageDto } from "@/types/api";
import { logActivity } from "./activity";
import { appendMessages, updateMessage } from "./ai-chats";
import { GALLERY_DRAFT_SELECT } from "./gallery";
import { createDraft, replaceDraftPhotos, updateDraft } from "./gallery-drafts";
import { ApiError, notFound } from "./http";
import { approveDraft, cancelPost, reschedulePost } from "./publishing";

/**
 * AI tab actions (AI4). The AI's answer may carry one action (lib/services/text/chat-actions.ts decides what
 * it means); this runs it with the same services and checks as the post card's buttons:
 * - save_draft runs at once (createDraft / updateDraft / replaceDraftPhotos) and updates the post card;
 * - schedule / post_now / reschedule / cancel are only *proposed*: an action card with Approve, valid for
 *   30 minutes; Approve (approveChatAction) checks everything again and calls approveDraft / reschedulePost /
 *   cancelPost.
 * Every action is an AiChatAction row (chat, message, draft, job, result) and an activity log entry.
 * Action cards are written by the server only (the chat routes refuse a client's "action" message).
 */

type Both = { en: string; ar: string };
type Lang = "en" | "ar";
const both = (key: MessageKey, vars?: Record<string, string | number>): Both => ({ en: translate("en", key, vars), ar: translate("ar", key, vars) });
const lText = (x: unknown): Both => {
  const v = (x ?? {}) as { en?: unknown; ar?: unknown };
  const en = typeof v.en === "string" ? v.en : "";
  const ar = typeof v.ar === "string" ? v.ar : "";
  return { en: en || ar, ar: ar || en };
};
const withTags = (caption: Both, hashtags: string[]): Both => ({
  en: `${caption.en}\n\n${hashtags.join(" ")}`.trim(),
  ar: `${caption.ar}\n\n${hashtags.join(" ")}`.trim(),
});

/** A post card's photo id on screen → the API's ("mathanet-07" → "sample:mathanet-07"); null if it's neither. */
export function apiPhotoId(screenId: string): string | null {
  if (parsePhotoRef(screenId)) return screenId;
  const sample = samplePhotoId(screenId);
  return parsePhotoRef(sample) ? sample : null;
}
const screenPhotoId = (apiId: string) => (apiId.startsWith("sample:") ? apiId.slice("sample:".length) : apiId);

interface CardPost {
  photoIds: string[];
  caption: Both;
  hashtags: string[];
  time?: string;
  draftId?: string;
  versions?: Array<{ caption: Both; hashtags: string[]; at: string }>;
  [key: string]: unknown;
}

/** A post card of the chat, as stored (AssistantMessage.payload). */
interface Card {
  messageId: string;
  payload: AiChatMessageDto & { post: CardPost };
}

export interface ActionContext {
  conversationId: string;
  chatKey: string;
  timeZone: string;
  refs: ChatPostRef[];
  cards: Map<string, Card>;
}

const jobStatusOf = (status: string | undefined, draftStatus: string): PostRefStatus => {
  if (status === "PUBLISHED" || draftStatus === "PUBLISHED") return "posted";
  if (status === "PUBLISHING") return "publishing";
  if (status === "SCHEDULED") return "scheduled";
  if (status === "FAILED") return "failed";
  return "draft";
};

/**
 * The posts the AI may act on: this chat's post cards (P1 = newest) and the business's upcoming / recently
 * failed scheduled posts (S1 = soonest), with their current state from the database.
 */
export async function actionContext(businessId: string, chatKey: string, now = Date.now()): Promise<ActionContext> {
  const conversation = await db.assistantConversation.findUnique({ where: { businessId_clientKey: { businessId, clientKey: chatKey } }, select: { id: true } });
  if (!conversation) throw notFound("Chat");
  const [business, rows] = await Promise.all([
    db.business.findUniqueOrThrow({ where: { id: businessId }, select: { timezone: true } }),
    db.assistantMessage.findMany({ where: { conversationId: conversation.id, role: "ASSISTANT" }, orderBy: { createdAt: "desc" }, take: 80, select: { clientId: true, payload: true } }),
  ]);
  const cardRows: Card[] = rows
    .filter((r) => r.clientId && (r.payload as { kind?: unknown } | null)?.kind === "post" && Array.isArray((r.payload as { post?: { photoIds?: unknown } }).post?.photoIds))
    .slice(0, ACTION_CARDS_MAX)
    .map((r) => ({ messageId: r.clientId!, payload: r.payload as unknown as Card["payload"] }));

  const draftIds = cardRows.map((c) => c.payload.post.draftId).filter((x): x is string => typeof x === "string");
  const [drafts, upcoming] = await Promise.all([
    draftIds.length ? db.postDraft.findMany({ where: { id: { in: draftIds }, businessId }, select: { ...GALLERY_DRAFT_SELECT, status: true } }) : Promise.resolve([]),
    db.scheduledPost.findMany({
      where: { businessId, OR: [{ status: "SCHEDULED" }, { status: "FAILED", updatedAt: { gte: new Date(now - 7 * 24 * 60 * 60 * 1000) } }], draft: { origin: { in: ["AI_CHAT", "GALLERY"] } } },
      orderBy: { scheduledFor: "asc" },
      take: ACTION_UPCOMING_MAX,
      select: { id: true, status: true, scheduledFor: true, draftId: true, draft: { select: { captionEn: true, captionAr: true, _count: { select: { photos: true } } } } },
    }),
  ]);
  const draftById = new Map(drafts.map((d) => [d.id, d]));

  const refs: ChatPostRef[] = [];
  const cards = new Map<string, Card>();
  cardRows.forEach((card, i) => {
    const ref = `P${i + 1}`;
    const draft = card.payload.post.draftId ? draftById.get(card.payload.post.draftId) : undefined;
    const job = draft?.scheduledPosts[0];
    cards.set(ref, card);
    refs.push({
      ref,
      kind: "card",
      messageId: card.messageId,
      draftId: draft?.id ?? null,
      jobId: job && job.status !== "PUBLISHED" ? job.id : null,
      status: draft ? jobStatusOf(job?.status, draft.status) : "unsaved",
      at: job?.scheduledFor.toISOString() ?? null,
      caption: draft ? draft.captionEn || draft.captionAr || "" : withTags(lText(card.payload.post.caption), card.payload.post.hashtags ?? []).en,
      photos: draft ? draft.photos.length : card.payload.post.photoIds.length,
    });
  });
  upcoming.forEach((job, i) =>
    refs.push({
      ref: `S${i + 1}`,
      kind: "scheduled",
      draftId: job.draftId,
      jobId: job.id,
      status: job.status === "FAILED" ? "failed" : "scheduled",
      at: job.scheduledFor.toISOString(),
      caption: job.draft.captionEn || job.draft.captionAr || "",
      photos: job.draft._count.photos,
    }),
  );
  return { conversationId: conversation.id, chatKey, timeZone: business.timezone, refs, cards };
}

/** The action types this business may use from the chat: drafts with the AI tab, Instagram ones with publishing. */
export function allowedActionTypes(permissions: Permissions): ChatActionType[] {
  return isFeatureEnabled(permissions, "gallery.publishing") ? ["save_draft", "schedule", "post_now", "reschedule", "cancel"] : ["save_draft"];
}

const ASK_KEY: Record<AskReason, MessageKey> = {
  no_post: "actionAskNoPost",
  which_post: "actionAskWhichPost",
  no_photo: "actionAskNoPhoto",
  when: "actionAskWhen",
  past: "actionAskPast",
  too_far: "actionAskTooFar",
  not_scheduled: "actionAskNotScheduled",
  posted: "actionAskPosted",
  publishing: "actionAskPublishing",
  photo_locked: "actionAskPhotoLocked",
  caption_missing: "actionAskCaptionMissing",
  failed: "actionError_generic",
};

/** A question back to the owner, written in code (EN + AR), saved in the chat; `content` is what the AI reads later. */
export async function saveAsk(businessId: string, ctx: ActionContext, messageId: string, reason: AskReason, language: Lang): Promise<AiChatMessageDto> {
  const text = both(ASK_KEY[reason]);
  const payload: AiChatMessageDto = { id: messageId, role: "ai", kind: "text", text };
  await db.assistantMessage.createMany({
    data: [{ conversationId: ctx.conversationId, clientId: messageId, role: "ASSISTANT", content: text[language], language, payload: payload as unknown as Prisma.InputJsonValue }],
    skipDuplicates: true,
  });
  await db.assistantConversation.update({ where: { id: ctx.conversationId }, data: { updatedAt: new Date() } });
  return payload;
}

const TYPE_DB = { save_draft: "SAVE_DRAFT", schedule: "SCHEDULE", post_now: "POST_NOW", reschedule: "RESCHEDULE", cancel: "CANCEL" } as const;
const STATUS_DB = { proposed: "PROPOSED", running: "RUNNING", done: "DONE", failed: "FAILED", expired: "EXPIRED", cancelled: "CANCELLED" } as const;

/** What a proposal recorded about the post, so Approve can tell when it changed meanwhile. */
interface ProposalInput {
  type: ChatActionType;
  at: string | null;
  previousAt: string | null;
  draftId: string | null;
  jobId: string | null;
  draftUpdatedAt: string | null;
  jobStatus: string | null;
  jobScheduledFor: string | null;
  caption: Both;
  photoIds: string[];
  timeZone: string;
  language: Lang;
  ref: string;
}

const cardMessage = (messageId: string, view: ChatActionView, intro: MessageKey): AiChatMessageDto => ({ id: messageId, role: "ai", kind: "action", text: both(intro), action: view as unknown as Record<string, unknown> });

/** The draft as the action card shows it: screen photo ids and its caption in both languages. */
async function draftPreview(businessId: string, draftId: string) {
  const draft = await db.postDraft.findFirst({ where: { id: draftId, businessId }, select: { ...GALLERY_DRAFT_SELECT, status: true } });
  if (!draft) throw notFound("Draft");
  const photoIds = draft.photos.map(({ photo }) => (photo.sampleKey ? photo.sampleKey : photo.igMediaId ? `ig:${photo.igMediaId}` : photo.id)).map(screenPhotoId);
  return { draft, photoIds, caption: lText({ en: draft.captionEn, ar: draft.captionAr }) };
}

/**
 * Runs or proposes the decided action and saves its card in the chat (message `messageId`). Returns the card
 * and the post cards it changed (a draft saved from a card updates that card).
 */
export async function runChatAction(input: {
  businessId: string;
  userId: string;
  permissions: Permissions;
  ctx: ActionContext;
  decision: Exclude<ActionDecision, { kind: "ask" }>;
  messageId: string;
  questionId: string | null;
  attachedPhotoIds: string[];
  language: Lang;
}): Promise<{ message: AiChatMessageDto; updated: AiChatMessageDto[] }> {
  const { businessId, userId, ctx, decision } = input;
  const updated: AiChatMessageDto[] = [];
  const steps: ChatActionStep[] = [];
  const target = decision.target;
  const card = target.kind === "card" ? ctx.cards.get(target.ref) : undefined;
  if (decision.kind === "propose" && !isFeatureEnabled(input.permissions, "gallery.publishing")) throw notFound();

  // 1. The draft: saved from the card when it isn't yet (allowed straight away), then the requested edits.
  let draftId = target.draftId ?? null;
  const save = decision.kind === "save" ? decision : null;
  const photoIds = save?.photo ? input.attachedPhotoIds : null;
  let changedCard: CardPost | null = null;
  if (!draftId) {
    if (!card) throw notFound("Post");
    const post = card.payload.post;
    const caption = save?.caption ?? lText(post.caption);
    const hashtags = save?.hashtags ?? post.hashtags ?? [];
    const ids = photoIds ?? post.photoIds.map(apiPhotoId).filter((x): x is string => !!x);
    const created = await createDraft(businessId, userId, { photoIds: ids, caption: withTags(caption, hashtags), hashtags, suggestedFor: post.time ? new Date(post.time) : null, origin: "ai_chat" });
    draftId = created.id;
    changedCard = { ...post, caption, hashtags, draftId, status: "saved", ...(photoIds ? { photoIds: photoIds.map(screenPhotoId) } : {}) };
    steps.push({ key: "draftSaved", state: "done" });
  } else if (save) {
    if (save.caption || save.hashtags) {
      const current = await draftPreview(businessId, draftId);
      const hashtags = save.hashtags ?? current.draft.hashtags;
      const caption = save.caption ?? (card ? lText(card.payload.post.caption) : null);
      if (caption) await updateDraft(businessId, draftId, { caption: withTags(caption, hashtags), hashtags, regenerated: !!save.caption });
      else await updateDraft(businessId, draftId, { hashtags });
      if (card && caption) {
        const post = card.payload.post;
        const versions = save.caption ? [{ caption: lText(post.caption), hashtags: post.hashtags ?? [], at: new Date().toISOString() }, ...(post.versions ?? [])].slice(0, 5) : post.versions;
        changedCard = { ...post, caption, hashtags, draftId, status: "saved", edited: false, versions };
      }
    }
    if (photoIds?.length) {
      await replaceDraftPhotos(businessId, draftId, photoIds);
      if (card) changedCard = { ...(changedCard ?? card.payload.post), photoIds: photoIds.map(screenPhotoId), draftId };
    }
    steps.push({ key: "draftSaved", state: "done" });
  }
  if (card && changedCard) {
    const payload = { ...card.payload, post: changedCard } as AiChatMessageDto;
    await updateMessage(businessId, ctx.chatKey, card.messageId, payload, { server: true });
    updated.push(payload);
  }

  const preview = await draftPreview(businessId, draftId);
  const job = preview.draft.scheduledPosts[0];

  // 2a. Saving a draft is done now.
  if (decision.kind === "save") {
    const view: ChatActionView = { id: "", type: "save_draft", status: "done", timeZone: ctx.timeZone, photoIds: preview.photoIds, caption: preview.caption, draftId, steps };
    const row = await db.aiChatAction.create({
      data: {
        businessId,
        conversationId: ctx.conversationId,
        messageClientId: input.messageId,
        questionClientId: input.questionId,
        userId,
        type: "SAVE_DRAFT",
        status: "DONE",
        input: { ref: target.ref, caption: save!.caption, hashtags: save!.hashtags, photo: save!.photo } as Prisma.InputJsonValue,
        draftId,
        result: { draftId } as Prisma.InputJsonValue,
        decidedAt: new Date(),
        decidedBy: userId,
      },
      select: { id: true },
    });
    view.id = row.id;
    await logActivity({ businessId, userId, action: "ai_chat.action", details: { actionId: row.id, type: "save_draft", status: "done", draftId } });
    const message = cardMessage(input.messageId, view, "actionIntroSaved");
    await appendMessages(businessId, ctx.chatKey, [message], { server: true });
    return { message, updated };
  }

  // 2b. Anything for Instagram waits for Approve.
  const type = decision.type;
  const proposal: ProposalInput = {
    type,
    at: decision.at?.toISOString() ?? null,
    previousAt: job && (type === "reschedule" || type === "cancel") ? job.scheduledFor.toISOString() : null,
    draftId,
    jobId: type === "reschedule" || type === "cancel" ? (target.jobId ?? job?.id ?? null) : null,
    draftUpdatedAt: preview.draft.updatedAt.toISOString(),
    jobStatus: job?.status ?? null,
    jobScheduledFor: job?.scheduledFor.toISOString() ?? null,
    caption: preview.caption,
    photoIds: preview.photoIds,
    timeZone: ctx.timeZone,
    language: input.language,
    ref: target.ref,
  };
  const expiresAt = new Date(Date.now() + PROPOSAL_TTL_MS);
  const row = await db.aiChatAction.create({
    data: {
      businessId,
      conversationId: ctx.conversationId,
      messageClientId: input.messageId,
      questionClientId: input.questionId,
      userId,
      type: TYPE_DB[type],
      status: "PROPOSED",
      input: proposal as unknown as Prisma.InputJsonValue,
      draftId,
      scheduledPostId: proposal.jobId,
      expiresAt,
    },
    select: { id: true },
  });
  await logActivity({ businessId, userId, action: "ai_chat.action", details: { actionId: row.id, type, status: "proposed", draftId, scheduledPostId: proposal.jobId, at: proposal.at } });
  const view = viewOf(row.id, proposal, "proposed", { expiresAt: expiresAt.toISOString(), steps });
  const message = cardMessage(input.messageId, view, "actionIntroProposed");
  await appendMessages(businessId, ctx.chatKey, [message], { server: true });
  return { message, updated };
}

function viewOf(id: string, p: ProposalInput, status: ChatActionStatus, extra: Partial<ChatActionView> = {}): ChatActionView {
  return {
    id,
    type: p.type,
    status,
    at: p.at,
    previousAt: p.previousAt,
    timeZone: p.timeZone,
    photoIds: p.photoIds,
    caption: p.caption,
    draftId: p.draftId,
    jobId: p.jobId,
    steps: [],
    ...extra,
  };
}

/** The reason code a refused or failed publishing call carries (publish_failed carries Instagram's reason). */
function errorCodeOf(error: unknown): string {
  if (error instanceof ApiError) {
    const details = Array.isArray(error.details) ? (error.details as Array<{ path?: string; message?: string }>) : [];
    const reason = error.code === "publish_failed" ? details.find((d) => d.path === "reason")?.message : null;
    return reason ?? error.code;
  }
  return "unavailable";
}

const INTRO: Record<ChatActionStatus, MessageKey> = {
  proposed: "actionIntroProposed",
  running: "actionIntroProposed",
  done: "actionIntroDone",
  failed: "actionIntroFailed",
  expired: "actionIntroExpired",
  cancelled: "actionIntroCancelled",
};

async function finish(
  row: { id: string; businessId: string; conversation: { clientKey: string | null }; messageClientId: string },
  p: ProposalInput,
  status: Exclude<ChatActionStatus, "proposed" | "running">,
  userId: string,
  extra: { steps: ChatActionStep[]; jobId?: string | null; at?: string | null; error?: string | null },
): Promise<AiChatMessageDto> {
  await db.aiChatAction.update({
    where: { id: row.id },
    data: {
      status: STATUS_DB[status],
      decidedBy: userId,
      decidedAt: new Date(),
      errorCode: extra.error ?? null,
      ...(extra.jobId && { scheduledPostId: extra.jobId }),
      result: { status, jobId: extra.jobId ?? p.jobId, at: extra.at ?? p.at, error: extra.error ?? null } as Prisma.InputJsonValue,
    },
  });
  await logActivity({ businessId: row.businessId, userId, action: "ai_chat.action", details: { actionId: row.id, type: p.type, status, draftId: p.draftId, scheduledPostId: extra.jobId ?? p.jobId, error: extra.error ?? null } });
  const view = viewOf(row.id, p, status, { steps: extra.steps, jobId: extra.jobId ?? p.jobId, at: extra.at ?? p.at, error: extra.error ?? null });
  const message = cardMessage(row.messageClientId, view, INTRO[status]);
  if (row.conversation.clientKey) await updateMessage(row.businessId, row.conversation.clientKey, row.messageClientId, message, { server: true }).catch(() => undefined);
  return message;
}

async function claim(businessId: string, actionId: string) {
  const row = await db.aiChatAction.findFirst({
    where: { id: actionId, businessId },
    select: { id: true, businessId: true, status: true, input: true, expiresAt: true, messageClientId: true, conversation: { select: { clientKey: true } } },
  });
  if (!row) throw notFound("Action");
  return row;
}

/** The card as it is now (a second tap on Approve, or an action already decided). */
async function currentCard(businessId: string, row: { conversation: { clientKey: string | null }; messageClientId: string }): Promise<AiChatMessageDto> {
  const conv = await db.assistantConversation.findFirst({ where: { businessId, clientKey: row.conversation.clientKey }, select: { id: true } });
  const msg = conv ? await db.assistantMessage.findUnique({ where: { conversationId_clientId: { conversationId: conv.id, clientId: row.messageClientId } }, select: { payload: true } }) : null;
  if (!msg) throw notFound("Action");
  return msg.payload as unknown as AiChatMessageDto;
}

/**
 * Approve on an action card: claims the proposal (once), refuses it when expired, switched off or changed
 * meanwhile, then runs it with the publishing services. Always answers the card in its new state; a refusal
 * by Instagram or the checks is a failed card with the reason (never a silent change).
 */
export async function approveChatAction(businessId: string, userId: string, permissions: Permissions, actionId: string, now = Date.now()): Promise<AiChatMessageDto> {
  const row = await claim(businessId, actionId);
  if (row.status !== "PROPOSED") return currentCard(businessId, row);
  const p = row.input as unknown as ProposalInput;
  const { count } = await db.aiChatAction.updateMany({ where: { id: row.id, status: "PROPOSED" }, data: { status: "RUNNING" } });
  if (count !== 1) return currentCard(businessId, row);

  if (row.expiresAt && row.expiresAt.getTime() <= now) return finish(row, p, "expired", userId, { steps: [{ key: "expired", state: "failed" }], error: "action_expired" });
  if (!isFeatureEnabled(permissions, "gallery.publishing")) return finish(row, p, "failed", userId, { steps: [{ key: "failed", state: "failed" }], error: "feature_disabled" });

  // The post must be as it was proposed: a caption edited, a time changed or a job started meanwhile → ask again.
  const draft = p.draftId ? await db.postDraft.findFirst({ where: { id: p.draftId, businessId }, select: { updatedAt: true } }) : null;
  const job = p.jobId ? await db.scheduledPost.findFirst({ where: { id: p.jobId, businessId }, select: { status: true, scheduledFor: true } }) : null;
  const stale =
    !draft ||
    draft.updatedAt.toISOString() !== p.draftUpdatedAt ||
    (p.jobId && (!job || job.status !== p.jobStatus || job.scheduledFor.toISOString() !== p.jobScheduledFor));
  if (stale) return finish(row, p, "failed", userId, { steps: [{ key: "failed", state: "failed" }], error: "action_stale" });
  if (p.at && Date.parse(p.at) <= now + 60_000) return finish(row, p, "failed", userId, { steps: [{ key: "failed", state: "failed" }], error: "action_past" });

  try {
    if (p.type === "schedule" || p.type === "post_now") {
      const jobId = await approveDraft(businessId, userId, p.draftId!, { at: p.type === "schedule" ? new Date(p.at!) : null, language: p.language });
      return finish(row, p, "done", userId, { steps: [p.type === "schedule" ? { key: "scheduled", state: "done", at: p.at } : { key: "sent", state: "done" }], jobId });
    }
    if (p.type === "reschedule") {
      await reschedulePost(businessId, userId, p.jobId!, p.at ? new Date(p.at) : null);
      return finish(row, p, "done", userId, { steps: [p.at ? { key: "scheduled", state: "done", at: p.at } : { key: "sent", state: "done" }] });
    }
    await cancelPost(businessId, userId, p.jobId!);
    return finish(row, p, "done", userId, { steps: [{ key: "cancelled", state: "done" }] });
  } catch (error) {
    return finish(row, p, "failed", userId, { steps: [{ key: "failed", state: "failed" }], error: errorCodeOf(error) });
  }
}

/** Cancel on an action card: nothing happens on Instagram; the card says it was dismissed. */
export async function dismissChatAction(businessId: string, userId: string, actionId: string): Promise<AiChatMessageDto> {
  const row = await claim(businessId, actionId);
  const { count } = await db.aiChatAction.updateMany({ where: { id: row.id, status: "PROPOSED" }, data: { status: "RUNNING" } });
  if (count !== 1) return currentCard(businessId, row);
  return finish(row, row.input as unknown as ProposalInput, "cancelled", userId, { steps: [{ key: "dismissed", state: "done" }] });
}
