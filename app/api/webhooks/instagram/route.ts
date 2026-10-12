import { timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { handleInstagramWebhook } from "@/lib/server/instagram-dm";
import { verifyWebhookSignature } from "@/lib/services/meta/messaging";

/**
 * Meta webhooks for Instagram messaging (App Dashboard → Webhooks → Instagram → "messages").
 *
 * GET  — the verification handshake: echoes hub.challenge when hub.verify_token matches
 *        META_WEBHOOK_VERIFY_TOKEN.
 * POST — direct-message events. The X-Hub-Signature-256 header must be the HMAC-SHA256
 *        of the raw body with META_APP_SECRET, or the request is rejected (403) unread.
 *        Valid deliveries get 200 at once; the work runs after the response
 *        (lib/server/instagram-dm.ts), so Meta never times out and retries.
 *
 * Not behind the login proxy (proxy.ts skips /api), and no session: Meta is the caller.
 */

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN?.trim();
  const challenge = params.get("hub.challenge");
  if (!expected || params.get("hub.mode") !== "subscribe" || !challenge || !sameSecret(params.get("hub.verify_token") ?? "", expected)) {
    return new Response("Forbidden", { status: 403 });
  }
  return new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
}

export async function POST(request: Request) {
  const appSecret = process.env.META_APP_SECRET?.trim();
  if (!appSecret) {
    console.error("[webhook:instagram] META_APP_SECRET is not set; can't verify deliveries.");
    return new Response("Not configured", { status: 503 });
  }
  const raw = await request.text();
  if (!verifyWebhookSignature(raw, request.headers.get("x-hub-signature-256"), appSecret)) {
    console.warn("[webhook:instagram] rejected a delivery with a missing or invalid signature.");
    return new Response("Invalid signature", { status: 403 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    // Signed but unreadable: acknowledge so Meta doesn't retry something we can never parse.
    console.warn("[webhook:instagram] signed delivery wasn't valid JSON; ignored.");
    return new Response("EVENT_RECEIVED", { status: 200 });
  }
  after(async () => {
    try {
      const summary = await handleInstagramWebhook(payload);
      if (summary.messages) console.info("[webhook:instagram]", JSON.stringify(summary));
    } catch (error) {
      console.error("[webhook:instagram] processing failed", (error as Error).message);
    }
  });
  return new Response("EVENT_RECEIVED", { status: 200 });
}
