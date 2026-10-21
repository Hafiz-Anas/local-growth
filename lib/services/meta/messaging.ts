import { createHmac, timingSafeEqual } from "node:crypto";
import { isMetaError } from "./errors";
import type { GraphClient } from "./graph";

/**
 * Instagram messaging through the Messenger Platform ("Instagram API with
 * Facebook Login"). Pure (the Graph client is injected) so tests run it
 * against recorded responses.
 *
 *  - Webhooks: Meta POSTs `object: "instagram"` events signed with
 *    X-Hub-Signature-256 (HMAC-SHA256 of the raw body with the app secret).
 *  - Sending: POST /me/messages with the Page token → { recipient: { id: IGSID }, message: { text } }.
 *    Instagram only accepts a reply within 24 hours of the customer's last message.
 *  - Private replies (keyword replies): the same endpoint with { recipient: { comment_id } } —
 *    one per comment, within 7 days of the comment.
 *  - Comment webhooks: `changes[].field === "comments"` on the same "instagram" object.
 */

/** Instagram rejects longer DMs ("1,000 bytes or less" in Meta's docs; we keep to characters and stay under). */
export const DM_MAX_LENGTH = 1000;
/** Standard messaging window: replies are allowed this long after the customer's last message. */
export const DM_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Private replies to a comment are accepted this long after the comment was posted. */
export const PRIVATE_REPLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// ── Webhook signature ────────────────────────────────────────────────────────

/** True only for `sha256=<hex>` matching HMAC-SHA256(rawBody, appSecret). Compared in constant time. */
export function verifyWebhookSignature(rawBody: string | Buffer, header: string | null | undefined, appSecret: string): boolean {
  if (!header || !appSecret) return false;
  const match = /^sha256=([a-f0-9]{64})$/i.exec(header.trim());
  if (!match) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const given = Buffer.from(match[1], "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// ── Webhook payload ──────────────────────────────────────────────────────────

/** One Instagram direct message from a webhook, normalized. */
export interface IncomingMessage {
  /** The business's Instagram professional account id (entry.id). */
  accountId: string;
  /** The customer's Instagram-scoped id: sender for incoming messages, recipient for echoes. */
  customerId: string;
  /** Meta's message id. */
  mid: string;
  /** Text, or "" when the message only has attachments / is a share or story reply without text. */
  text: string;
  hasAttachments: boolean;
  /** Sent by the business itself (from the Instagram app or through the API). */
  isEcho: boolean;
  sentAt: Date;
}

interface RawMessaging {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: { mid?: string; text?: string; is_echo?: boolean; is_deleted?: boolean; is_unsupported?: boolean; attachments?: unknown[] };
}

/**
 * The direct messages in a webhook body. Everything else (reactions, read receipts,
 * postbacks, deleted or unsupported messages, other objects) is ignored.
 */
export function parseInstagramWebhook(payload: unknown): IncomingMessage[] {
  const body = payload as { object?: string; entry?: Array<{ id?: string; time?: number; messaging?: RawMessaging[] }> } | null;
  if (!body || body.object !== "instagram" || !Array.isArray(body.entry)) return [];
  const out: IncomingMessage[] = [];
  for (const entry of body.entry) {
    if (!entry?.id || !Array.isArray(entry.messaging)) continue;
    for (const m of entry.messaging) {
      const message = m?.message;
      if (!message?.mid || message.is_deleted || message.is_unsupported) continue;
      const isEcho = message.is_echo === true;
      const customerId = isEcho ? m.recipient?.id : m.sender?.id;
      if (!customerId || customerId === entry.id) continue;
      out.push({
        accountId: entry.id,
        customerId,
        mid: message.mid,
        text: typeof message.text === "string" ? message.text : "",
        hasAttachments: Array.isArray(message.attachments) && message.attachments.length > 0,
        isEcho,
        sentAt: new Date(typeof m.timestamp === "number" ? m.timestamp : (entry.time ?? Date.now())),
      });
    }
  }
  return out;
}

/** A new comment on one of the business's posts, from a "comments" webhook change. */
export interface IncomingComment {
  /** The business's Instagram professional account id (entry.id). */
  accountId: string;
  commentId: string;
  /** The post the comment is on (null if Meta left it out). */
  mediaId: string | null;
  /** Set when the comment is a reply in another comment's thread. */
  parentId: string | null;
  /** The commenter's Instagram-scoped id and username. */
  fromId: string | null;
  fromUsername: string | null;
  text: string;
  /** When Meta sent the change (comments carry no timestamp of their own). */
  receivedAt: Date;
}

interface RawCommentChange {
  field?: string;
  value?: { id?: string; text?: string; parent_id?: string; from?: { id?: string; username?: string }; media?: { id?: string } };
}

/** Webhook times are in seconds for `changes` and in milliseconds for `messaging`; accept both. */
const toDate = (t: number | undefined) => new Date(typeof t !== "number" ? Date.now() : t < 1e12 ? t * 1000 : t);

/** The comments in a webhook body ("comments" field). Everything else is ignored. */
export function parseCommentWebhook(payload: unknown): IncomingComment[] {
  const body = payload as { object?: string; entry?: Array<{ id?: string; time?: number; changes?: RawCommentChange[] }> } | null;
  if (!body || body.object !== "instagram" || !Array.isArray(body.entry)) return [];
  const out: IncomingComment[] = [];
  for (const entry of body.entry) {
    if (!entry?.id || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      const v = change?.value;
      if (change?.field !== "comments" || !v?.id || typeof v.text !== "string") continue;
      out.push({
        accountId: entry.id,
        commentId: v.id,
        mediaId: v.media?.id ?? null,
        parentId: v.parent_id ?? null,
        fromId: v.from?.id ?? null,
        fromUsername: v.from?.username ?? null,
        text: v.text,
        receivedAt: toDate(entry.time),
      });
    }
  }
  return out;
}

// ── Sending ──────────────────────────────────────────────────────────────────

/** Why Instagram didn't deliver a DM, beyond the generic Graph errors (token, permission, rate limit). */
export type MessagingFailureReason =
  /** More than 24 hours since the customer's last message (7 days since the comment, for private replies). */
  | "window_closed"
  /** The customer can't be messaged (blocked the account, deactivated, or unknown IGSID). */
  | "recipient_unavailable"
  /** Instagram refused the message itself (too long, invalid). */
  | "message_rejected"
  /** Private replies: this comment already got its one private reply. */
  | "already_replied"
  /** Private replies: the comment was deleted or can't be found. */
  | "comment_unavailable";

export class MetaMessagingError extends Error {
  constructor(
    readonly reason: MessagingFailureReason,
    /** Meta's own wording (English), for the integration log. */
    readonly detail = "",
  ) {
    super(`Instagram didn't deliver the message: ${reason}${detail ? ` — ${detail}` : ""}`);
    this.name = "MetaMessagingError";
  }
}

/** "(#10) This message is sent outside of allowed window." — Instagram / Messenger subcodes (classified invalid_request in errors.ts). */
const WINDOW_CLOSED_SUBCODES = new Set([2534022, 2018278]);
/** Recipient can't receive messages (551 "This person isn't available right now"; 100/2534014 "no matching user"). */
const UNAVAILABLE = (code: number, subcode: number) => code === 551 || subcode === 2534014 || subcode === 2018001;

/** Private replies: "Activity already replied to" (one private reply per comment). */
const ALREADY_REPLIED_CODE = 10900;

async function postMessage(client: GraphClient, pageToken: string, recipient: { id: string } | { comment_id: string }, text: string, call: string): Promise<{ messageId: string }> {
  if (text.length > DM_MAX_LENGTH) throw new MetaMessagingError("message_rejected", `Longer than ${DM_MAX_LENGTH} characters.`);
  try {
    const res = await client.post<{ recipient_id?: string; message_id?: string }>(
      "me/messages",
      { recipient: JSON.stringify(recipient), message: JSON.stringify({ text }) },
      { call, token: pageToken, scopes: ["instagram_manage_messages"] },
    );
    return { messageId: res.message_id ?? "" };
  } catch (error) {
    if (isMetaError(error) && error.kind !== "token_invalid" && error.kind !== "rate_limited") {
      const code = error.code ?? -1;
      const subcode = error.subcode ?? -1;
      if (WINDOW_CLOSED_SUBCODES.has(subcode)) throw new MetaMessagingError("window_closed", error.message);
      if (code === ALREADY_REPLIED_CODE) throw new MetaMessagingError("already_replied", error.message);
      if ("comment_id" in recipient && error.kind === "not_found") throw new MetaMessagingError("comment_unavailable", error.message);
      if (UNAVAILABLE(code, subcode)) throw new MetaMessagingError("recipient_unavailable", error.message);
      if (error.kind === "invalid_request") throw new MetaMessagingError("message_rejected", error.message);
    }
    throw error;
  }
}

export function sendTextMessage(client: GraphClient, pageToken: string, recipientId: string, text: string): Promise<{ messageId: string }> {
  return postMessage(client, pageToken, { id: recipientId }, text, "POST /me/messages");
}

/** Private reply: a DM to the author of a comment, addressed by the comment id (once per comment, within 7 days). */
export function sendPrivateReply(client: GraphClient, pageToken: string, commentId: string, text: string): Promise<{ messageId: string }> {
  return postMessage(client, pageToken, { comment_id: commentId }, text, "POST /me/messages (private reply)");
}

/** Username of the person behind an IGSID (User Profile API). Null when Meta won't say. */
export async function fetchMessagingProfile(client: GraphClient, pageToken: string, igsid: string): Promise<{ username: string | null; name: string | null; avatarUrl: string | null } | null> {
  try {
    const p = await client.get<{ username?: string; name?: string; profile_pic?: string }>(igsid, { fields: "username,name,profile_pic" }, { call: "GET /{igsid}?fields=username", token: pageToken, scopes: ["instagram_manage_messages"], quiet: true });
    return { username: p.username ?? null, name: p.name ?? null, avatarUrl: p.profile_pic ?? null };
  } catch (error) {
    if (isMetaError(error, "token_invalid") || isMetaError(error, "rate_limited")) throw error;
    return null;
  }
}

/**
 * Installs the app on the Page so Meta delivers its Instagram webhooks (needs pages_manage_metadata).
 * Which Instagram fields arrive (messages, comments) is chosen in the App Dashboard; this call only
 * has to name a Page field ("subscribe to any Page field", Meta's Instagram webhooks guide). It names
 * "feed", which needs only pages_manage_metadata — the Page field "messages" is Messenger's and needs
 * pages_messaging, which the app doesn't ask for, so subscribing to it always failed with (#200).
 */
export async function subscribePageToMessages(client: GraphClient, pageId: string, pageToken: string): Promise<boolean> {
  const res = await client.post<{ success?: boolean }>(`${pageId}/subscribed_apps`, { subscribed_fields: "feed" }, { call: "POST /{page}/subscribed_apps", token: pageToken, scopes: ["pages_manage_metadata"] });
  return res.success === true;
}
