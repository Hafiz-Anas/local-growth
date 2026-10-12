import "server-only";
import { timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { decrypt, encrypt, lookupKey, randomToken } from "@/lib/crypto";
import { db } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { exchangeCode, exchangeLongLived, inspectToken, listPages } from "@/lib/services/meta/api";
import { buildDialogUrl, ESSENTIAL_SCOPES, getMetaConfig, META_SCOPES } from "@/lib/services/meta/config";
import { MetaApiError } from "@/lib/services/meta/errors";
import { toPageOption, type PageCandidate, type TokenInfo } from "@/lib/services/meta/mappers";
import type { MetaConnectOutcome, MetaPageOptionDto } from "@/types";
import { logActivity } from "./activity";
import { ensureWebhookSubscription } from "./instagram-dm";
import { logIntegration } from "./integration-log";
import { syncInstagram } from "./instagram-sync";
import { graphFor } from "./meta-client";
import { sealCredentials } from "./meta-credentials";
import { recordError } from "./onboarding";

/**
 * Facebook Login for Business → a connected Instagram professional account.
 *
 *  1. /api/integrations/instagram/start   random `state` in an encrypted, httpOnly cookie bound to the
 *                                         user + business (CSRF); redirect to Meta's dialog.
 *  2. Meta → /api/integrations/instagram/callback with ?code (or #access_token in "token" mode,
 *     posted once to /api/integrations/instagram/token by a tiny page that then clears the URL).
 *  3. Code → token (server-side, app secret) → long-lived token → /debug_token (must be OUR app,
 *     valid, with the essential scopes) → /me/accounts.
 *  4. One Page with Instagram → connect. Several → MetaPendingConnection + picker. None → help screen.
 *  5. Connect: encrypt the credentials, refuse an account already connected elsewhere, import
 *     profile + 50 posts now and insights/comments right after the redirect.
 * Tokens never reach the browser (except Meta's own fragment in token mode, which is cleared at once)
 * and are never logged.
 */

export const OAUTH_COOKIE = "lge_meta_oauth";
export const OAUTH_COOKIE_PATH = "/api/integrations/instagram";
const STATE_MAX_AGE_S = 10 * 60;
const PENDING_TTL_MS = 15 * 60 * 1000;

export type ReturnTo = "onboarding" | "settings";

export interface ConnectContext {
  businessId: string;
  userId: string;
  onboarding: boolean;
}

interface OAuthState {
  s: string;
  b: string;
  u: string;
  r: ReturnTo;
  t: number;
}

/** Where to send the user back to, with the outcome for the page to explain. */
export function returnUrl(returnTo: ReturnTo, outcome: MetaConnectOutcome, extra?: Record<string, string>): string {
  const params = new URLSearchParams({ instagram: outcome, ...extra });
  return returnTo === "onboarding" ? `/onboarding?${params}` : `/settings?${params}#instagram`;
}

/** Step 1: the dialog URL and the sealed state cookie value. */
export function beginLogin(ctx: ConnectContext, returnTo: ReturnTo, rerequest: boolean): { url: string; cookie: string } {
  const config = getMetaConfig();
  if (!config) throw new Error("Meta is not configured.");
  const state = randomToken(24);
  const cookie = encrypt(JSON.stringify({ s: state, b: ctx.businessId, u: ctx.userId, r: returnTo, t: Date.now() } satisfies OAuthState));
  return { url: buildDialogUrl(config, state, { rerequest }), cookie };
}

export const stateCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: OAUTH_COOKIE_PATH,
  maxAge: STATE_MAX_AGE_S,
};

/**
 * Checks the `state` Meta sent back against the cookie: same value (constant-time),
 * not expired, and issued to the same signed-in user and business.
 */
export function verifyState(cookie: string | undefined, state: string | null, ctx: ConnectContext): { ok: true; returnTo: ReturnTo } | { ok: false; returnTo: ReturnTo; reason: "missing" | "expired" | "mismatch" } {
  // Without a readable cookie, send the user back to where they are (the wizard redirects /settings away).
  const fallback: ReturnTo = ctx.onboarding ? "onboarding" : "settings";
  if (!cookie) return { ok: false, returnTo: fallback, reason: "missing" };
  let parsed: OAuthState;
  try {
    parsed = JSON.parse(decrypt(cookie)) as OAuthState;
  } catch {
    return { ok: false, returnTo: fallback, reason: "mismatch" };
  }
  const returnTo: ReturnTo = parsed.r === "onboarding" ? "onboarding" : "settings";
  if (Date.now() - parsed.t > STATE_MAX_AGE_S * 1000) return { ok: false, returnTo, reason: "expired" };
  const a = Buffer.from(parsed.s ?? "");
  const b = Buffer.from(state ?? "");
  if (!state || a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, returnTo, reason: "mismatch" };
  if (parsed.b !== ctx.businessId || parsed.u !== ctx.userId) return { ok: false, returnTo, reason: "mismatch" };
  return { ok: true, returnTo };
}

/** Records a failed connect for admins (IntegrationEvent) and, in the wizard, as an onboarding error. */
async function fail(ctx: ConnectContext, outcome: Exclude<MetaConnectOutcome, "connected" | "pick">, message: string, details: Prisma.InputJsonObject = {}): Promise<MetaConnectOutcome> {
  await logIntegration({ businessId: ctx.businessId, level: outcome === "cancelled" ? "info" : "warning", call: "oauth.connect", errorCode: outcome, message, details });
  if (ctx.onboarding) await recordError(ctx.businessId, "instagram", { kind: "connect", reason: outcome, provider: "meta" });
  return outcome;
}

export async function recordCancelled(ctx: ConnectContext, reason: string | null) {
  return fail(ctx, "cancelled", "The user closed or declined Facebook Login.", { reason: reason ?? "unknown" });
}

export async function recordStateFailure(ctx: ConnectContext, reason: string) {
  return fail(ctx, reason === "expired" ? "expired" : "error", `Login state check failed (${reason}).`, { reason });
}

interface UserGrant {
  userToken: string;
  info: TokenInfo;
}

/** Step 3 (code mode): exchange the authorization code server-side. */
export async function finishWithCode(ctx: ConnectContext, code: string): Promise<{ outcome: MetaConnectOutcome; username?: string }> {
  const client = graphFor(ctx.businessId, { connectionEffects: false });
  try {
    const short = await exchangeCode(client, code);
    return finishWithToken(ctx, short.accessToken, null);
  } catch (error) {
    return { outcome: await fail(ctx, "error", `Code exchange failed: ${(error as Error).message}`) };
  }
}

/**
 * Step 3 (both modes): long-lived token, validation, Pages. `longLived` is the
 * token Meta already put in the fragment (token mode) — still validated.
 */
export async function finishWithToken(ctx: ConnectContext, token: string, longLived: string | null): Promise<{ outcome: MetaConnectOutcome; username?: string }> {
  const client = graphFor(ctx.businessId, { connectionEffects: false });
  let grant: UserGrant;
  try {
    let userToken = longLived;
    if (!userToken) userToken = (await exchangeLongLived(client, token)).accessToken;
    grant = { userToken, info: await inspectToken(client, userToken) };
  } catch (error) {
    const message = error instanceof MetaApiError ? `${error.call}: ${error.message}` : (error as Error).message;
    return { outcome: await fail(ctx, "error", `Token validation failed: ${message}`) };
  }

  const missingEssential = ESSENTIAL_SCOPES.filter((s) => !grant.info.scopes.includes(s));
  if (missingEssential.length) {
    return { outcome: await fail(ctx, "declined", `Essential permissions not granted: ${missingEssential.join(", ")}`, { missing: missingEssential }) };
  }

  let candidates: PageCandidate[];
  let pagesWithoutInstagram = 0;
  try {
    ({ candidates, pagesWithoutInstagram } = await listPages(client, grant.userToken));
  } catch (error) {
    return { outcome: await fail(ctx, "error", `Listing Pages failed: ${(error as Error).message}`) };
  }

  if (candidates.length === 0) {
    return { outcome: await fail(ctx, "no_account", `No Facebook Page with an Instagram professional account (${pagesWithoutInstagram} Page(s) without one).`, { pagesWithoutInstagram }) };
  }
  if (candidates.length === 1) return connectCandidate(ctx, grant, candidates[0]);

  await db.metaPendingConnection.upsert({
    where: { businessId: ctx.businessId },
    update: { userId: ctx.userId, returnTo: ctx.onboarding ? "onboarding" : "settings", credentialsEncrypted: encrypt(JSON.stringify({ grant, candidates })), options: candidates.map(toPageOption) as unknown as Prisma.InputJsonArray, expiresAt: new Date(Date.now() + PENDING_TTL_MS) },
    create: { businessId: ctx.businessId, userId: ctx.userId, returnTo: ctx.onboarding ? "onboarding" : "settings", credentialsEncrypted: encrypt(JSON.stringify({ grant, candidates })), options: candidates.map(toPageOption) as unknown as Prisma.InputJsonArray, expiresAt: new Date(Date.now() + PENDING_TTL_MS) },
  });
  await logIntegration({ businessId: ctx.businessId, level: "info", call: "oauth.connect", errorCode: "pick", message: `${candidates.length} Instagram accounts found — waiting for the user to pick one.` });
  return { outcome: "pick" };
}

/** Picker choices of a pending login (no tokens); null when there is none or it expired. */
export async function getPendingOptions(businessId: string): Promise<MetaPageOptionDto[] | null> {
  const pending = await db.metaPendingConnection.findUnique({ where: { businessId }, select: { options: true, expiresAt: true } });
  if (!pending || pending.expiresAt < new Date()) return null;
  return pending.options as unknown as MetaPageOptionDto[];
}

export async function cancelPending(businessId: string) {
  await db.metaPendingConnection.deleteMany({ where: { businessId } });
}

/** Step 4 (several accounts): the user picked one. */
export async function connectPending(ctx: ConnectContext, pageId: string): Promise<{ outcome: MetaConnectOutcome; username?: string }> {
  const pending = await db.metaPendingConnection.findUnique({ where: { businessId: ctx.businessId } });
  if (!pending || pending.expiresAt < new Date() || pending.userId !== ctx.userId) {
    await cancelPending(ctx.businessId);
    return { outcome: await fail(ctx, "expired", "The account choice expired before the user picked one.") };
  }
  const { grant, candidates } = JSON.parse(decrypt(pending.credentialsEncrypted)) as { grant: UserGrant; candidates: PageCandidate[] };
  const candidate = candidates.find((c) => c.pageId === pageId);
  if (!candidate) return { outcome: await fail(ctx, "error", "The picked Page isn't one of the options.") };
  // Re-hydrate the dates JSON turned into strings.
  grant.info.expiresAt = grant.info.expiresAt ? new Date(grant.info.expiresAt) : null;
  grant.info.dataAccessExpiresAt = grant.info.dataAccessExpiresAt ? new Date(grant.info.dataAccessExpiresAt) : null;
  return connectCandidate(ctx, grant, candidate);
}

/** Step 5: store the connection (encrypted) and import the account. */
async function connectCandidate(ctx: ConnectContext, grant: UserGrant, page: PageCandidate): Promise<{ outcome: MetaConnectOutcome; username?: string }> {
  const { businessId } = ctx;
  const accountKey = lookupKey(`ig:${page.igUserId}`);

  const elsewhere = await db.instagramConnection.findFirst({ where: { igAccountKey: accountKey, businessId: { not: businessId } }, select: { id: true } });
  const handleTaken = page.username ? await db.business.count({ where: { instagramHandle: page.username, id: { not: businessId } } }) : 0;
  if (elsewhere || handleTaken) {
    await cancelPending(businessId);
    return { outcome: await fail(ctx, "taken", "This Instagram account is already connected to another business.", { username: page.username }) };
  }

  const missing = META_SCOPES.filter((s) => !grant.info.scopes.includes(s));
  const credentials = sealCredentials({
    userToken: grant.userToken,
    userTokenExpiresAt: grant.info.expiresAt?.toISOString() ?? null,
    dataAccessExpiresAt: grant.info.dataAccessExpiresAt?.toISOString() ?? null,
    metaUserId: grant.info.userId,
    pageId: page.pageId,
    pageName: page.pageName,
    pageToken: page.pageToken,
    igUserId: page.igUserId,
    scopes: grant.info.scopes,
  });
  const now = new Date();
  const data = {
    provider: "META" as const,
    status: "CONNECTED" as const,
    username: page.username,
    igUserId: null,
    accessTokenEncrypted: null,
    credentialsEncrypted: credentials,
    igAccountKey: accountKey,
    tokenExpiresAt: grant.info.expiresAt,
    dataAccessExpiresAt: grant.info.dataAccessExpiresAt,
    missingPermissions: missing,
    connectedAt: now,
    lastSyncError: null,
    syncStartedAt: null,
    // A new login may be a different Page: subscribe it to the DM webhooks again.
    webhookSubscribedAt: null,
  };
  const previous = await db.instagramConnection.findUnique({ where: { businessId }, select: { igAccountKey: true } });
  await db.$transaction(async (tx) => {
    // A different account than before: drop the old account's synced posts and comments.
    if (previous?.igAccountKey && previous.igAccountKey !== accountKey) {
      await tx.instagramMedia.deleteMany({ where: { businessId } });
      await tx.instagramMediaComment.deleteMany({ where: { businessId } });
      await tx.instagramAccountSnapshot.deleteMany({ where: { businessId } });
      await tx.instagramConnection.update({ where: { businessId }, data: { profile: Prisma.DbNull, insights: Prisma.DbNull } });
    }
    await tx.instagramConnection.upsert({ where: { businessId }, update: data, create: { businessId, ...data } });
    if (page.username) await tx.business.update({ where: { id: businessId }, data: { instagramHandle: page.username } });
    await tx.metaPendingConnection.deleteMany({ where: { businessId } });
    await logActivity({ businessId, userId: ctx.userId, action: "instagram.connected", details: { username: page.username, provider: "meta" } }, tx);
  });
  await logIntegration({
    businessId,
    level: "info",
    call: "oauth.connected",
    message: `Connected @${page.username} (Page "${page.pageName}").${missing.length ? ` Not granted: ${missing.join(", ")}.` : ""}`,
    details: { scopes: grant.info.scopes, missing, tokenExpiresAt: grant.info.expiresAt?.toISOString() ?? null },
  });

  // Profile + posts before the user lands back (the wizard needs them); insights and comments right after.
  await syncInstagram(businessId, { scope: "basic", reason: "connect" }).catch((e) => console.error("[meta] initial sync failed", (e as Error).message));
  after(() => syncInstagram(businessId, { scope: "deferred", reason: "connect" }).catch((e) => console.error("[meta] initial sync failed", (e as Error).message)));
  after(() => ensureWebhookSubscription(businessId));
  return { outcome: "connected", username: page.username };
}

/** Disconnect: forget every token and the account key (another business may connect the account later). */
export async function disconnectMeta(businessId: string) {
  await db.metaPendingConnection.deleteMany({ where: { businessId } });
  await db.instagramConnection.updateMany({
    where: { businessId },
    data: {
      status: "DISCONNECTED",
      accessTokenEncrypted: null,
      credentialsEncrypted: null,
      igAccountKey: null,
      tokenExpiresAt: null,
      dataAccessExpiresAt: null,
      connectedAt: null,
      missingPermissions: [],
      syncStartedAt: null,
      lastSyncError: null,
    },
  });
}

/** Removes expired picker sessions (called opportunistically). */
export async function purgeExpiredPending() {
  await db.metaPendingConnection.deleteMany({ where: { expiresAt: { lt: new Date() } } });
}
