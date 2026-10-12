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
import "dotenv/config";
import { createHmac, randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import { decrypt } from "../lib/crypto";
import { describeDatabase, isProductionTarget } from "./db-target";

function fail(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const handle = arg("handle")?.replace(/^@/, "");
  if (!handle) fail('Missing --handle. Example: npm run simulate-dm -- --handle mybusiness --text "How much is the cake?"');
  const text = arg("text") ?? "Hi! Do you deliver today?";
  const customerId = arg("from") ?? "sim_customer_1";
  const baseUrl = (arg("url") ?? process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  const appSecret = process.env.META_APP_SECRET?.trim();
  if (!appSecret) fail("META_APP_SECRET is not set: the webhook only accepts deliveries signed with it.");
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) fail("DATABASE_URL is not set.");
  if (isProductionTarget(databaseUrl) || !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(baseUrl)) {
    fail(`simulate-dm only runs against a local app and database (got ${describeDatabase(databaseUrl)} and ${baseUrl}).`);
  }

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    const conn = await db.instagramConnection.findFirst({
      where: { username: handle, status: { not: "DISCONNECTED" } },
      select: { provider: true, igUserId: true, credentialsEncrypted: true, business: { select: { name: true } } },
    });
    if (!conn) fail(`No connected Instagram account @${handle} in ${describeDatabase(databaseUrl)}.`);
    let accountId = conn.igUserId;
    if (conn.provider === "META") {
      try {
        accountId = (JSON.parse(decrypt(conn.credentialsEncrypted ?? "")) as { igUserId: string }).igUserId;
      } catch {
        fail("Couldn't read this Meta connection (ENCRYPTION_KEY changed?).");
      }
      console.warn("⚠ This is a Meta connection: the draft will be created, but approving it calls the real Graph API, which rejects a simulated customer.");
    }
    if (!accountId) fail(`@${handle} has no Instagram account id; reconnect it.`);

    const now = Date.now();
    const body = JSON.stringify({
      object: "instagram",
      entry: [{ id: accountId, time: now, messaging: [{ sender: { id: customerId }, recipient: { id: accountId }, timestamp: now, message: { mid: `sim_${randomUUID()}`, text } }] }],
    });
    const signature = `sha256=${createHmac("sha256", appSecret).update(body).digest("hex")}`;
    const res = await fetch(`${baseUrl}/api/webhooks/instagram`, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": signature }, body });
    if (!res.ok) fail(`The webhook answered HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    console.log(`✔ Sent a simulated DM from "${customerId}" to @${handle} (${conn.business.name}). The reply draft appears in Engagement → approval queue in a moment (only if "AI replies" is on for this business).`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => fail((error as Error).message));
