import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { classifyGraphError, MetaApiError } from "../../lib/services/meta/errors";
import { appsecretProof } from "../../lib/services/meta/graph";
import {
  MetaMessagingError,
  fetchMessagingProfile,
  parseCommentWebhook,
  parseInstagramWebhook,
  sendPrivateReply,
  sendTextMessage,
  subscribePageToMessages,
  verifyWebhookSignature,
} from "../../lib/services/meta/messaging";
import { CONFIG, client, err, ok } from "./helpers";

const SECRET = "test-app-secret-not-real";
const sign = (body: string, secret = SECRET) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

const IG = "17841400000000001";
const message = (over: Record<string, unknown> = {}, msg: Record<string, unknown> = {}) => ({
  sender: { id: "5550001" },
  recipient: { id: IG },
  timestamp: 1760000000000,
  message: { mid: "m_1", text: "How much is the honey cake?", ...msg },
  ...over,
});
const webhook = (...messaging: unknown[]) => ({ object: "instagram", entry: [{ id: IG, time: 1760000000001, messaging }] });

describe("webhook signature", () => {
  const body = JSON.stringify(webhook(message()));

  it("accepts Meta's HMAC-SHA256 of the raw body", () => {
    assert.equal(verifyWebhookSignature(body, sign(body), SECRET), true);
    assert.equal(verifyWebhookSignature(Buffer.from(body), sign(body).toUpperCase().replace("SHA256=", "sha256="), SECRET), true);
  });

  it("rejects a wrong secret, a changed body, and malformed or missing headers", () => {
    assert.equal(verifyWebhookSignature(body, sign(body, "other-secret"), SECRET), false);
    assert.equal(verifyWebhookSignature(body + " ", sign(body), SECRET), false);
    assert.equal(verifyWebhookSignature(body, sign(body).replace("sha256=", "sha1="), SECRET), false);
    assert.equal(verifyWebhookSignature(body, "sha256=abc", SECRET), false);
    assert.equal(verifyWebhookSignature(body, null, SECRET), false);
    assert.equal(verifyWebhookSignature(body, sign(body), ""), false);
  });
});

describe("parseInstagramWebhook", () => {
  it("normalizes an incoming text message", () => {
    assert.deepEqual(parseInstagramWebhook(webhook(message())), [
      { accountId: IG, customerId: "5550001", mid: "m_1", text: "How much is the honey cake?", hasAttachments: false, isEcho: false, sentAt: new Date(1760000000000) },
    ]);
  });

  it("marks echoes (sent by the business) with the customer as the other side", () => {
    const [echo] = parseInstagramWebhook(webhook(message({ sender: { id: IG }, recipient: { id: "5550001" } }, { is_echo: true, text: "Thanks!" })));
    assert.equal(echo.isEcho, true);
    assert.equal(echo.customerId, "5550001");
  });

  it("keeps attachment-only messages and skips everything else", () => {
    const parsed = parseInstagramWebhook(
      webhook(
        message({}, { mid: "m_2", text: undefined, attachments: [{ type: "image", payload: { url: "https://x" } }] }),
        message({}, { mid: "m_3", is_deleted: true }),
        message({}, { mid: "m_4", is_unsupported: true }),
        { sender: { id: "5550001" }, recipient: { id: IG }, timestamp: 1, read: { mid: "m_1" } },
        { sender: { id: "5550001" }, recipient: { id: IG }, timestamp: 1, reaction: { mid: "m_1", action: "react", reaction: "love" } },
      ),
    );
    assert.deepEqual(parsed.map((m) => [m.mid, m.text, m.hasAttachments]), [["m_2", "", true]]);
    assert.deepEqual(parseInstagramWebhook({ object: "page", entry: [] }), []);
    assert.deepEqual(parseInstagramWebhook(null), []);
  });
});

describe("sendTextMessage", () => {
  it("posts to /me/messages with the Page token and appsecret_proof", async () => {
    const { client: c, calls } = client(() => ok({ recipient_id: "5550001", message_id: "mid_out_1" }));
    assert.deepEqual(await sendTextMessage(c, "page-token", "5550001", "Hi! It's 3 KD 🍯"), { messageId: "mid_out_1" });
    const call = calls[0];
    assert.equal(call.method, "POST");
    assert.equal(call.path, "me/messages");
    assert.deepEqual(JSON.parse(call.params.get("recipient")!), { id: "5550001" });
    assert.deepEqual(JSON.parse(call.params.get("message")!), { text: "Hi! It's 3 KD 🍯" });
    assert.equal(call.params.get("appsecret_proof"), appsecretProof("page-token", CONFIG.appSecret));
  });

  it("is sent once, never retried", async () => {
    const { client: c, calls } = client(() => err({ error: { message: "Service unavailable", code: 2 } }, 503));
    await assert.rejects(sendTextMessage(c, "page-token", "5550001", "hi"));
    assert.equal(calls.length, 1);
  });

  it("maps the 24-hour window, unavailable recipients and rejected messages", async () => {
    const cases: Array<[object, string]> = [
      [{ message: "(#10) This message is sent outside of allowed window.", code: 10, error_subcode: 2534022 }, "window_closed"],
      [{ message: "(#551) This person isn't available right now.", code: 551 }, "recipient_unavailable"],
      [{ message: "(#100) No matching user found", code: 100, error_subcode: 2534014 }, "recipient_unavailable"],
      [{ message: "(#100) Invalid parameter", code: 100 }, "message_rejected"],
    ];
    for (const [error, reason] of cases) {
      const { client: c } = client(() => err({ error }));
      await assert.rejects(sendTextMessage(c, "t", "5550001", "hi"), (e) => e instanceof MetaMessagingError && e.reason === reason);
    }
    const { client: c, calls } = client(() => ok({}));
    await assert.rejects(sendTextMessage(c, "t", "5550001", "x".repeat(1001)), (e) => e instanceof MetaMessagingError && e.reason === "message_rejected");
    assert.equal(calls.length, 0);
  });

  it("leaves token and rate-limit errors to the generic handling", async () => {
    for (const [error, kind] of [
      [{ message: "Error validating access token", code: 190, error_subcode: 460 }, "token_invalid"],
      [{ message: "(#4) Application request limit reached", code: 4 }, "rate_limited"],
    ] as const) {
      const { client: c } = client(() => err({ error }, kind === "token_invalid" ? 401 : 400));
      await assert.rejects(sendTextMessage(c, "t", "5550001", "hi"), (e) => e instanceof MetaApiError && e.kind === kind);
    }
  });

  it("doesn't treat a closed window as a missing permission", () => {
    assert.equal(classifyGraphError({ code: 10, error_subcode: 2534022 }), "invalid_request");
    assert.equal(classifyGraphError({ code: 10, error_subcode: 2018278 }), "invalid_request");
    assert.equal(classifyGraphError({ code: 10 }), "permission");
  });
});

describe("profiles and Page subscription", () => {
  it("reads the sender's username, and returns null when Meta won't say", async () => {
    const { client: c } = client(() => ok({ username: "noura.kw", name: "Noura", profile_pic: "https://cdn/p.jpg" }));
    assert.deepEqual(await fetchMessagingProfile(c, "t", "5550001"), { username: "noura.kw", name: "Noura", avatarUrl: "https://cdn/p.jpg" });
    const { client: c2 } = client(() => err({ error: { message: "Unsupported get request", code: 100, error_subcode: 33 } }));
    assert.equal(await fetchMessagingProfile(c2, "t", "5550001"), null);
  });

  it("subscribes the Page to the messages field", async () => {
    const { client: c, calls } = client(() => ok({ success: true }));
    assert.equal(await subscribePageToMessages(c, "2002", "page-token"), true);
    assert.equal(calls[0].path, "2002/subscribed_apps");
    assert.equal(calls[0].params.get("subscribed_fields"), "feed");
  });
});

describe("parseCommentWebhook", () => {
  const change = (value: Record<string, unknown>, field = "comments") => ({ field, value });
  const commentWebhook = (...changes: unknown[]) => ({ object: "instagram", entry: [{ id: IG, time: 1760000000, changes }] });

  it("normalizes a new comment (Meta sends change times in seconds)", () => {
    const parsed = parseCommentWebhook(commentWebhook(change({ id: "c_1", text: "MENU 😍", from: { id: "5550001", username: "noura.kw" }, media: { id: "m_1", media_product_type: "FEED" } })));
    assert.deepEqual(parsed, [
      { accountId: IG, commentId: "c_1", mediaId: "m_1", parentId: null, fromId: "5550001", fromUsername: "noura.kw", text: "MENU 😍", receivedAt: new Date(1760000000 * 1000) },
    ]);
  });

  it("keeps the thread parent of replies, and ignores other fields, messages and other objects", () => {
    const parsed = parseCommentWebhook(
      commentWebhook(
        change({ id: "c_2", text: "thanks", parent_id: "c_1", from: { id: IG, username: "dallabean.cafe" }, media: { id: "m_1" } }),
        change({ id: "c_3", text: "live!" }, "live_comments"),
        change({ id: "c_4" }),
        change({ text: "no id" }),
      ),
    );
    assert.deepEqual(parsed.map((c) => [c.commentId, c.parentId]), [["c_2", "c_1"]]);
    assert.deepEqual(parseCommentWebhook(webhook(message())), [], "a DM webhook has no comments");
    assert.deepEqual(parseInstagramWebhook(commentWebhook(change({ id: "c_1", text: "MENU" }))), [], "a comment webhook has no DMs");
    assert.deepEqual(parseCommentWebhook({ object: "page", entry: [{ id: IG, changes: [change({ id: "c", text: "x" })] }] }), []);
    assert.deepEqual(parseCommentWebhook(null), []);
  });
});

describe("sendPrivateReply", () => {
  it("posts to /me/messages addressed by comment id", async () => {
    const { client: c, calls } = client(() => ok({ recipient_id: "5550001", message_id: "mid_pr_1" }));
    assert.deepEqual(await sendPrivateReply(c, "page-token", "c_1", "Here's our menu 📋"), { messageId: "mid_pr_1" });
    assert.equal(calls[0].path, "me/messages");
    assert.deepEqual(JSON.parse(calls[0].params.get("recipient")!), { comment_id: "c_1" });
    assert.deepEqual(JSON.parse(calls[0].params.get("message")!), { text: "Here's our menu 📋" });
  });

  it("maps one-per-comment, the 7-day window, deleted comments and blocked users", async () => {
    const cases: Array<[object, string]> = [
      [{ message: "(#10900) Activity already replied to", code: 10900 }, "already_replied"],
      [{ message: "(#10) This message is sent outside of allowed window.", code: 10, error_subcode: 2534022 }, "window_closed"],
      [{ message: "Unsupported post request. Object does not exist", code: 100, error_subcode: 33 }, "comment_unavailable"],
      [{ message: "(#551) This person isn't available right now.", code: 551 }, "recipient_unavailable"],
      [{ message: "(#100) Invalid parameter", code: 100 }, "message_rejected"],
    ];
    for (const [error, reason] of cases) {
      const { client: c } = client(() => err({ error }));
      await assert.rejects(sendPrivateReply(c, "t", "c_1", "hi"), (e) => e instanceof MetaMessagingError && e.reason === reason, reason);
    }
  });

  it("refuses text over the limit without calling Meta, and leaves token and rate-limit errors to the generic handling", async () => {
    const { client: c, calls } = client(() => ok({}));
    await assert.rejects(sendPrivateReply(c, "t", "c_1", "x".repeat(1001)), (e) => e instanceof MetaMessagingError && e.reason === "message_rejected");
    assert.equal(calls.length, 0);
    for (const [error, kind] of [
      [{ message: "Error validating access token", code: 190, error_subcode: 463 }, "token_invalid"],
      [{ message: "(#4) Application request limit reached", code: 4 }, "rate_limited"],
    ] as const) {
      const { client: c2 } = client(() => err({ error }, kind === "token_invalid" ? 401 : 400));
      await assert.rejects(sendPrivateReply(c2, "t", "c_1", "hi"), (e) => e instanceof MetaApiError && e.kind === kind);
    }
  });
});
