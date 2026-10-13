/**
 * Simulates an incoming Instagram DM without Meta: `npm run simulate-dm -- --handle <instagram handle> --text "…"`.
 *
 * Builds the same webhook body Meta sends, signs it with META_APP_SECRET
 * (X-Hub-Signature-256) and POSTs it to /api/webhooks/instagram on the running
 * app, so the real path runs: signature check → business lookup → feature check
 * → stored message → AI reply draft in the Engagement approval queue.
 *
 * Options:
 *   --handle  the business's connected Instagram username (required)
 *   --text    the customer's message (default: a sample question)
 *   --from    the customer's id; reuse it to continue the same conversation (default "sim_customer_1")
 *   --url     the app (default AUTH_URL, else http://localhost:3000)
 *
 * For a mock connection, approving the draft "sends" through the mock. For a Meta
 * connection, approving calls the real Graph API, which rejects a simulated
 * customer — use a real DM for that. Refuses to run against a production database.
 * Never prints secrets.
 */
import { randomUUID } from "node:crypto";
import { arg, deliver, fail, openTarget } from "./webhook-sim";

async function main() {
  const handle = arg("handle")?.replace(/^@/, "");
  if (!handle) fail('Missing --handle. Example: npm run simulate-dm -- --handle mybusiness --text "How much is the cake?"');
  const text = arg("text") ?? "Hi! Do you deliver today?";
  const customerId = arg("from") ?? "sim_customer_1";

  const target = await openTarget("simulate-dm", handle);
  try {
    if (target.provider === "META") console.warn("⚠ This is a Meta connection: the draft will be created, but approving it calls the real Graph API, which rejects a simulated customer.");
    const now = Date.now();
    await deliver(target, {
      object: "instagram",
      entry: [{ id: target.accountId, time: now, messaging: [{ sender: { id: customerId }, recipient: { id: target.accountId }, timestamp: now, message: { mid: `sim_${randomUUID()}`, text } }] }],
    });
    console.log(`✔ Sent a simulated DM from "${customerId}" to @${handle} (${target.businessName}). The reply draft appears in Engagement → approval queue in a moment (only if "AI replies" is on for this business).`);
  } finally {
    await target.db.$disconnect();
  }
}

main().catch((error) => fail((error as Error).message));
