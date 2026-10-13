/**
 * Shared by the local webhook simulators (npm run simulate-dm / simulate-comment): finds the
 * connected business by handle, refuses anything but a local app and database, and POSTs a
 * webhook body signed with META_APP_SECRET exactly like Meta does. Never prints secrets.
 */
import "dotenv/config";
import { createHmac } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import { decrypt } from "../lib/crypto";
import { describeDatabase, isProductionTarget } from "./db-target";

export function fail(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

export function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Only http://localhost or 127.0.0.1, with an optional port. */
export const isLocalUrl = (url: string) => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url);

export interface SimTarget {
  db: PrismaClient;
  baseUrl: string;
  appSecret: string;
  /** The business's Instagram account id, as Meta puts it in entry.id. */
  accountId: string;
  provider: "MOCK" | "META";
  businessId: string;
  businessName: string;
}

export async function openTarget(script: string, handle: string): Promise<SimTarget> {
  const baseUrl = (arg("url") ?? process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  const appSecret = process.env.META_APP_SECRET?.trim();
  if (!appSecret) fail("META_APP_SECRET is not set: the webhook only accepts deliveries signed with it.");
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) fail("DATABASE_URL is not set.");
  if (isProductionTarget(databaseUrl) || !isLocalUrl(baseUrl)) {
    fail(`${script} only runs against a local app and database (got ${describeDatabase(databaseUrl)} and ${baseUrl}).`);
  }

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const conn = await db.instagramConnection.findFirst({
    where: { username: handle, status: { not: "DISCONNECTED" } },
    select: { provider: true, igUserId: true, credentialsEncrypted: true, businessId: true, business: { select: { name: true } } },
  });
  if (!conn) {
    await db.$disconnect();
    fail(`No connected Instagram account @${handle} in ${describeDatabase(databaseUrl)}.`);
  }
  let accountId = conn.igUserId;
  if (conn.provider === "META") {
    try {
      accountId = (JSON.parse(decrypt(conn.credentialsEncrypted ?? "")) as { igUserId: string }).igUserId;
    } catch {
      await db.$disconnect();
      fail("Couldn't read this Meta connection (ENCRYPTION_KEY changed?).");
    }
  }
  if (!accountId) {
    await db.$disconnect();
    fail(`@${handle} has no Instagram account id; reconnect it.`);
  }
  return { db, baseUrl, appSecret, accountId, provider: conn.provider, businessId: conn.businessId, businessName: conn.business.name };
}

/** POSTs the body to /api/webhooks/instagram with Meta's X-Hub-Signature-256. */
export async function deliver(target: SimTarget, payload: unknown) {
  const body = JSON.stringify(payload);
  const signature = `sha256=${createHmac("sha256", target.appSecret).update(body).digest("hex")}`;
  const res = await fetch(`${target.baseUrl}/api/webhooks/instagram`, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": signature }, body });
  if (!res.ok) fail(`The webhook answered HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
