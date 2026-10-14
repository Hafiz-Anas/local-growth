import "server-only";
import { lookupKey } from "@/lib/crypto";
import { db } from "@/lib/db";
import { isFeatureEnabled, permissionsFromRows } from "@/lib/permissions";
import { getAIService } from "@/lib/services/ai";
import {
  InstagramMessagingError,
  InstagramNotConnectedError,
  getInstagramService,
} from "@/lib/services/instagram";
import { DM_MAX_LENGTH, DM_WINDOW_MS, parseInstagramWebhook, subscribePageToMessages, type IncomingMessage, type MessagingFailureReason } from "@/lib/services/meta/messaging";
import { logActivity } from "./activity";
import { ApiError } from "./http";
import { getInstagramAccount } from "./instagram-account";
import { instagramApiError } from "./instagram-errors";
import { logIntegration } from "./integration-log";
import { graphFor } from "./meta-client";
import { openCredentials } from "./meta-credentials";
import { notifyRepliesWaiting } from "./notifications";

/**
 * Instagram DM auto-replies.
 *
 *  1. Meta POSTs each direct message to /api/webhooks/instagram (signature checked there).
 *  2. handleInstagramWebhook — after the 200 has gone out — finds the business by its
 *     Instagram account, stores the message, and (only when "AI replies" is on for that
 *     business) drafts a reply with the same AIService call the comment replies use.
 *     One PENDING draft per conversation: a follow-up message updates it.
 *  3. Like comment replies, nothing is sent until someone approves the draft on the
 *     Engagement page → sendDmReply (Graph: POST /me/messages).
 *
 * Instagram only accepts a reply within 24 hours of the customer's last message: older
 * drafts become EXPIRED. Nothing in here throws out of the webhook path; failures go to
 * the integration log.
 */

const DM_FEATURE = "engagement.aiReplies" as const;
/** The customer's messages kept in the draft for the reviewer (and the AI). */
const DRAFT_CONTEXT_CHARS = 1000;

// ── Webhook → drafts ─────────────────────────────────────────────────────────

export interface WebhookSummary {
  messages: number;
  drafted: number;
  ignored: number;
}

export async function handleInstagramWebhook(payload: unknown): Promise<WebhookSummary> {
  const summary: WebhookSummary = { messages: 0, drafted: 0, ignored: 0 };
  for (const message of parseInstagramWebhook(payload)) {
    summary.messages += 1;
    try {
      const outcome = await processMessage(message);
      if (outcome === "drafted") summary.drafted += 1;
      else if (outcome === "ignored") summary.ignored += 1;
    } catch (error) {
      console.error("[dm] webhook message failed", (error as Error).message);
    }
  }
  return summary;
}

/** The connected business behind an Instagram account id (Meta: by its lookup key; mock: by the stored id). */
export async function businessForAccount(accountId: string) {
  return db.instagramConnection.findFirst({
    where: {
      status: { not: "DISCONNECTED" },
      OR: [{ igAccountKey: lookupKey(`ig:${accountId}`) }, { provider: "MOCK", igUserId: accountId }],
    },
    select: { businessId: true, provider: true },
  });
}

async function processMessage(message: IncomingMessage): Promise<"drafted" | "stored" | "ignored"> {
  const connection = await businessForAccount(message.accountId);
  if (!connection) {
    console.warn("[dm] webhook for an Instagram account that isn't connected here; ignored.");
    return "ignored";
  }
  const { businessId } = connection;

  // "AI replies" off for this business → do nothing at all with its DMs.
  const rows = await db.featurePermission.findMany({ where: { businessId }, select: { featureKey: true, enabled: true } });
  if (!isFeatureEnabled(permissionsFromRows(rows), DM_FEATURE)) return "ignored";

  const text = message.text.trim() || (message.hasAttachments ? "[attachment]" : "");
  if (!text) return "ignored";

  if (message.isEcho) {
    // Sent by the business itself. Our own API replies are already stored (same mid → skipped).
    const stored = await storeMessage(businessId, message, text, null);
    if (stored) {
      // Answered directly in the Instagram app: the pending draft for this customer is no longer needed.
      await db.replyDraft.updateMany({ where: { businessId, channel: "DM", recipientId: message.customerId, status: "PENDING" }, data: { status: "DISMISSED" } });
    }
    return "stored";
  }

  const account = await getInstagramAccount(businessId);
  const known = await db.instagramDirectMessage.findFirst({
    where: { businessId, customerId: message.customerId, customerUsername: { not: null } },
    select: { customerUsername: true },
    orderBy: { sentAt: "desc" },
  });
  const profile = known ? null : await getInstagramService().getMessagingProfile(account, message.customerId).catch(() => null);
  const username = known?.customerUsername ?? profile?.username ?? null;

  if (!(await storeMessage(businessId, message, text, username))) return "ignored"; // a webhook retry
  // Attachments only (photo, voice note, story share): stored, but there's nothing to answer automatically.
  if (!message.text.trim()) return "stored";

  await draftForConversation(businessId, message, username, profile?.avatarUrl ?? null);
  return "drafted";
}

/** False when the message was already stored (Meta retries webhooks). */
async function storeMessage(businessId: string, message: IncomingMessage, text: string, username: string | null): Promise<boolean> {
  try {
    await db.instagramDirectMessage.create({
      data: { businessId, igMessageId: message.mid, customerId: message.customerId, customerUsername: username, fromBusiness: message.isEcho, text, sentAt: message.sentAt },
    });
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return false;
    throw error;
  }
}

async function draftForConversation(businessId: string, message: IncomingMessage, username: string | null, avatarUrl: string | null) {
  const business = await db.business.findUnique({
    where: { id: businessId },
    select: { name: true, nameAr: true, niche: true, brandVoice: { select: { toneLevel: true, brandWords: true, defaultHashtags: true } } },
  });
  if (!business) return;
  const pending = await db.replyDraft.findFirst({ where: { businessId, channel: "DM", recipientId: message.customerId, status: "PENDING" }, select: { id: true, commentText: true } });
  // Everything the customer wrote since the last reply, newest last.
  const conversation = (pending ? `${pending.commentText}\n${message.text}` : message.text).slice(-DRAFT_CONTEXT_CHARS);
  const voice = business.brandVoice;

  let draftText: string;
  try {
    // Same call as the comment replies (lib/server/instagram-sync.ts); the AI answers the latest message.
    const draft = await getAIService().draftReply({
      businessId,
      businessName: business.name,
      businessNameAr: business.nameAr,
      niche: business.niche,
      commentText: message.text,
      commenterUsername: username ?? "",
      brandVoice: { toneLevel: voice?.toneLevel ?? 50, brandWords: voice?.brandWords ?? [], defaultHashtags: voice?.defaultHashtags ?? [] },
      channel: "dm",
    });
    draftText = draft.text.slice(0, DM_MAX_LENGTH);
  } catch (error) {
    await logIntegration({ businessId, level: "error", call: "dm.draft", message: `Couldn't draft a DM reply: ${(error as Error).message}` });
    return;
  }

  const display = username ?? "";
  if (pending) {
    await db.replyDraft.update({ where: { id: pending.id }, data: { commentText: conversation, draftReply: draftText, lastMessageAt: message.sentAt, ...(display && { commenterUsername: display }) } });
  } else {
    await db.replyDraft.create({
      data: {
        businessId,
        channel: "DM",
        commentId: message.mid,
        commentText: conversation,
        commenterUsername: display,
        commenterAvatarUrl: avatarUrl,
        draftReply: draftText,
        recipientId: message.customerId,
        lastMessageAt: message.sentAt,
      },
    });
  }
  await notifyRepliesWaiting(businessId);
}

// ── Approve → send ──────────────────────────────────────────────────────────

export function dmWindowOpen(lastMessageAt: Date | null, now = Date.now()): boolean {
  return Boolean(lastMessageAt) && now - lastMessageAt!.getTime() < DM_WINDOW_MS;
}

/** PENDING DM drafts whose 24-hour window has closed → EXPIRED (run before listing the queue). */
export async function expireClosedDmDrafts(businessId: string): Promise<number> {
  const { count } = await db.replyDraft.updateMany({
    where: { businessId, channel: "DM", status: "PENDING", lastMessageAt: { lt: new Date(Date.now() - DM_WINDOW_MS) } },
    data: { status: "EXPIRED" },
  });
  return count;
}

/** API error for a DM that can't be sent (the UI shows the localized reason). */
function dmApiError(reason: MessagingFailureReason | "too_long"): ApiError {
  if (reason === "window_closed") return new ApiError(409, "dm_window_closed", "Instagram only allows replies within 24 hours of the customer's last message.");
  return new ApiError(422, "dm_failed", `Instagram didn't deliver the message (${reason}).`, [{ path: "reason", message: reason }]);
}

/**
 * Sends an approved DM draft. The draft is already claimed (APPROVED) by the caller;
 * on success it becomes POSTED, on a closed window EXPIRED, otherwise back to PENDING.
 * Always throws an ApiError on failure.
 */
export async function sendDmReply(input: { businessId: string; draftId: string; recipientId: string; lastMessageAt: Date | null; text: string; userId: string }) {
  const { businessId, draftId } = input;
  const revert = () => db.replyDraft.update({ where: { id: draftId }, data: { status: "PENDING", reviewedBy: null } });

  if (input.text.length > DM_MAX_LENGTH) {
    await revert();
    throw dmApiError("too_long");
  }
  if (!dmWindowOpen(input.lastMessageAt)) {
    await db.replyDraft.update({ where: { id: draftId }, data: { status: "EXPIRED" } });
    throw dmApiError("window_closed");
  }
  const account = await getInstagramAccount(businessId);
  if (!account.connected) {
    await revert();
    throw new ApiError(409, "instagram_not_connected", "Connect Instagram to send replies.");
  }

  let sentId: string;
  try {
    sentId = (await getInstagramService().replyToMessage(account, input.recipientId, input.text)).id;
  } catch (error) {
    if (error instanceof InstagramMessagingError) {
      await logIntegration({
        businessId,
        provider: account.provider,
        level: error.reason === "window_closed" ? "warning" : "error",
        call: "dm.send",
        errorCode: error.reason,
        message: `DM reply not delivered (${error.reason}).${error.detail ? ` ${error.detail}` : ""}`,
        details: { replyDraftId: draftId },
      });
      if (error.reason === "window_closed") await db.replyDraft.update({ where: { id: draftId }, data: { status: "EXPIRED" } });
      else await revert();
      throw dmApiError(error.reason);
    }
    await revert();
    if (error instanceof InstagramNotConnectedError) throw new ApiError(409, "instagram_not_connected", "Connect Instagram to send replies.");
    const apiError = instagramApiError(error, "Instagram didn't accept the reply. Try again.");
    if (apiError.code === "instagram_error") {
      console.error("[instagram] replyToMessage failed", error);
      await logIntegration({ businessId, provider: account.provider, level: "error", call: "dm.send", errorCode: "failed", message: `DM reply failed: ${(error as Error)?.message ?? "unknown error"}`, details: { replyDraftId: draftId } });
    }
    throw apiError;
  }

  await db.$transaction(async (tx) => {
    await tx.replyDraft.update({ where: { id: draftId }, data: { status: "POSTED", draftReply: input.text } });
    if (sentId) {
      await tx.instagramDirectMessage.createMany({
        data: [{ businessId, igMessageId: sentId, customerId: input.recipientId, fromBusiness: true, text: input.text, sentAt: new Date() }],
        skipDuplicates: true,
      });
    }
    await logActivity({ businessId, userId: input.userId, action: "reply.dm_sent", details: { replyDraftId: draftId } }, tx);
  });
}

// ── Page subscription ────────────────────────────────────────────────────────

/**
 * Installs this app on the Facebook Page behind a Meta connection, once per connect/reconnect,
 * so Meta delivers the Instagram webhooks the app subscribes to in the App Dashboard
 * ("messages" for DM replies, "comments" for keyword replies). Meta: "subscribe to any Page
 * field" — Instagram fields such as comments are not Page fields, so the call names "messages".
 * Needs pages_manage_metadata plus the permission of at least one of the two features; without
 * them (or on failure) it's logged and skipped — connecting and syncing never fail because of it.
 */
export async function ensureWebhookSubscription(businessId: string): Promise<void> {
  try {
    const conn = await db.instagramConnection.findUnique({ where: { businessId }, select: { provider: true, status: true, credentialsEncrypted: true, webhookSubscribedAt: true } });
    if (conn?.provider !== "META" || conn.status !== "CONNECTED" || conn.webhookSubscribedAt) return;
    const credentials = openCredentials(conn.credentialsEncrypted);
    if (!credentials) return;
    const has = (scope: string) => credentials.scopes.includes(scope);
    if (!has("pages_manage_metadata") || !(has("instagram_manage_messages") || has("instagram_manage_comments"))) {
      await logIntegration({ businessId, level: "warning", call: "webhook.subscribe", message: "Webhooks (DM replies, keyword replies) need pages_manage_metadata plus instagram_manage_messages and/or instagram_manage_comments. Reconnect Instagram and allow them." });
      return;
    }
    if (!has("instagram_manage_messages")) await logIntegration({ businessId, level: "warning", call: "webhook.subscribe", message: "instagram_manage_messages wasn't granted: DM replies and private keyword DMs won't work until Instagram is reconnected with it." });
    const ok = await subscribePageToMessages(graphFor(businessId), credentials.pageId, credentials.pageToken);
    if (!ok) throw new Error("Meta didn't confirm the subscription.");
    await db.instagramConnection.update({ where: { businessId }, data: { webhookSubscribedAt: new Date() } });
    await logIntegration({ businessId, level: "info", call: "webhook.subscribe", message: `Page "${credentials.pageName}" subscribed to Instagram webhooks (messages, comments).` });
  } catch (error) {
    // Graph errors are already logged (and flagged) by graphFor.
    console.error("[dm] webhook subscription failed", (error as Error).message);
  }
}
