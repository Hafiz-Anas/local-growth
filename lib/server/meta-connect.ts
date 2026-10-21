import "server-only";
import { timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { decrypt, encrypt, lookupKey, randomToken } from "@/lib/crypto";
import { db } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { exchangeCode, exchangeLongLived, inspectToken, listPages } from "@/lib/services/meta/api";
import { buildDialogUrl, ESSENTIAL_SCOPES, getMetaConfig } from "@/lib/services/meta/config";
import { MetaApiError } from "@/lib/services/meta/errors";
import { toPageOption, type PageCandidate, type TokenInfo } from "@/lib/services/meta/mappers";
import { grantFields } from "@/lib/services/meta/permissions";
import { isDevModeRefusal } from "@/lib/signup-flow";
import type { MetaConnectOutcome, MetaPageOptionDto } from "@/types";
import { isOwnOtherAccount } from "./accounts";
import { logActivity } from "./activity";
import { ensureWebhookSubscription } from "./instagram-dm";
import { logIntegration } from "./integration-log";
import { syncInstagram } from "./instagram-sync";
import { graphFor } from "./meta-client";
import { sealCredentials } from "./meta-credentials";
import { adoptInstagramName, recordError } from "./onboarding";

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

export type ReturnTo = "signup" | "onboarding" | "settings";

const RETURN_TOS: ReturnTo[] = ["signup", "onboarding", "settings"];
export const asReturnTo = (value: string | null | undefined): ReturnTo => (RETURN_TOS.includes(value as ReturnTo) ? (value as ReturnTo) : "settings");

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
  if (returnTo === "signup") return `/signup/instagram?${params}`;
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
  // Without a readable cookie, send the user back to where they are (the sign-up screen sends
  // a connected account on to the wizard, and the wizard redirects /settings away).
  const fallback: ReturnTo = ctx.onboarding ? "signup" : "settings";
  if (!cookie) return { ok: false, returnTo: fallback, reason: "missing" };
  let parsed: OAuthState;
  try {
    parsed = JSON.parse(decrypt(cookie)) as OAuthState;
  } catch {
    return { ok: false, returnTo: fallback, reason: "mismatch" };
  }
  const returnTo = asReturnTo(parsed.r);
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
  if (reason === "not_tester") return fail(ctx, "not_tester", "Meta refused the login: the app is in development mode and this person isn't a tester.");
  return fail(ctx, reason === "expired" ? "expired" : "error", `Login state check failed (${reason}).`, { reason });
}

export interface UserGrant {
  userToken: string;
  info: TokenInfo;
}

type GrantFailure = { ok: false; outcome: "error" | "declined" | "no_account" | "not_tester"; message: string; details?: Prisma.InputJsonObject };

/**
 * Step 3 without side effects (shared with sign-up, which has no business yet): long-lived token,
 * validation (our app, essential scopes) and the Pages with an Instagram account. `code` is exchanged
 * first when given; `longLived` is the token Meta already put in the fragment (token mode).
 */
export async function grantAndPages(businessId: string | null, input: { code: string } | { token: string; longLived: string | null }): Promise<{ ok: true; grant: UserGrant; candidates: PageCandidate[] } | GrantFailure> {
  const client = graphFor(businessId, { connectionEffects: false });
  const failed = (stage: string, error: unknown): GrantFailure => {
    const message = error instanceof MetaApiError ? `${error.call}: ${error.message}` : (error as Error).message;
    // Development mode: Meta refuses people who aren't testers of the app.
    return { ok: false, outcome: isDevModeRefusal(message) ? "not_tester" : "error", message: `${stage} failed: ${message}` };
  };
  let token: string;
  let longLived: string | null;
  if ("code" in input) {
    try {
      token = (await exchangeCode(client, input.code)).accessToken;
      longLived = null;
    } catch (error) {
      return failed("Code exchange", error);
    }
  } else ({ token, longLived } = input);

  let grant: UserGrant;
  try {
    const userToken = longLived ?? (await exchangeLongLived(client, token)).accessToken;
    grant = { userToken, info: await inspectToken(client, userToken) };
  } catch (error) {
    return failed("Token validation", error);
  }

  const missingEssential = ESSENTIAL_SCOPES.filter((s) => !grant.info.scopes.includes(s));
  if (missingEssential.length) return { ok: false, outcome: "declined", message: `Essential permissions not granted: ${missingEssential.join(", ")}`, details: { missing: missingEssential } };

  let candidates: PageCandidate[];
  let pagesWithoutInstagram = 0;
  try {
    ({ candidates, pagesWithoutInstagram } = await listPages(client, grant.userToken));
  } catch (error) {
    return failed("Listing Pages", error);
  }
  if (candidates.length === 0) {
    return { ok: false, outcome: "no_account", message: `No Facebook Page with an Instagram professional account (${pagesWithoutInstagram} Page(s) without one).`, details: { pagesWithoutInstagram } };
  }
  return { ok: true, grant, candidates };
}

/** Step 3 (code mode): exchange the authorization code server-side. */
export async function finishWithCode(ctx: ConnectContext, code: string): Promise<{ outcome: MetaConnectOutcome; username?: string }> {
  return finishGrant(ctx, await grantAndPages(ctx.businessId, { code }));
}

/** Step 3 (token mode): the token from the fragment — still validated. */
export async function finishWithToken(ctx: ConnectContext, token: string, longLived: string | null): Promise<{ outcome: MetaConnectOutcome; username?: string }> {
  return finishGrant(ctx, await grantAndPages(ctx.businessId, { token, longLived }));
}

async function finishGrant(ctx: ConnectContext, result: Awaited<ReturnType<typeof grantAndPages>>): Promise<{ outcome: MetaConnectOutcome; username?: string }> {
  if (!result.ok) return { outcome: await fail(ctx, result.outcome, result.message, result.details) };
  const { grant, candidates } = result;
  if (candidates.length === 1) return connectCandidate(ctx, grant, candidates[0]);

  await db.metaPendingConnection.upsert({
    where: { businessId: ctx.businessId },
    update: { userId: ctx.userId, returnTo: ctx.onboarding ? "signup" : "settings", credentialsEncrypted: encrypt(JSON.stringify({ grant, candidates })), options: candidates.map(toPageOption) as unknown as Prisma.InputJsonArray, expiresAt: new Date(Date.now() + PENDING_TTL_MS) },
    create: { businessId: ctx.businessId, userId: ctx.userId, returnTo: ctx.onboarding ? "signup" : "settings", credentialsEncrypted: encrypt(JSON.stringify({ grant, candidates })), options: candidates.map(toPageOption) as unknown as Prisma.InputJsonArray, expiresAt: new Date(Date.now() + PENDING_TTL_MS) },
  });
  await logIntegration({ businessId: ctx.businessId, level: "info", call: "oauth.connect", errorCode: "pick", message: `${candidates.length} Instagram accounts found — waiting for the user to pick one.` });
  return { outcome: "pick" };
}

/** JSON (encrypted at rest) turned the token info's dates into strings: re-hydrate them. */
export function reviveGrant(grant: UserGrant): UserGrant {
  grant.info.expiresAt = grant.info.expiresAt ? new Date(grant.info.expiresAt) : null;
  grant.info.dataAccessExpiresAt = grant.info.dataAccessExpiresAt ? new Date(grant.info.dataAccessExpiresAt) : null;
  return grant;
}

export const metaAccountKey = (igUserId: string) => lookupKey(`ig:${igUserId}`);

/**
 * The InstagramConnection fields of a Meta connection (credentials encrypted). A reconnect replaces
 * all of them, so the scopes, missing permissions and webhook subscription follow the new token.
 */
export function metaConnectionData(grant: UserGrant, page: PageCandidate) {
  const fields = grantFields(grant.info);
  const credentials = sealCredentials({
    userToken: grant.userToken,
    userTokenExpiresAt: grant.info.expiresAt?.toISOString() ?? null,
    dataAccessExpiresAt: grant.info.dataAccessExpiresAt?.toISOString() ?? null,
    metaUserId: grant.info.userId,
    pageId: page.pageId,
    pageName: page.pageName,
    pageToken: page.pageToken,
    igUserId: page.igUserId,
    scopes: fields.scopes,
  });
  return {
    provider: "META" as const,
    status: "CONNECTED" as const,
    username: page.username,
    igUserId: null,
    accessTokenEncrypted: null,
    credentialsEncrypted: credentials,
    igAccountKey: metaAccountKey(page.igUserId),
    tokenExpiresAt: fields.tokenExpiresAt,
    dataAccessExpiresAt: fields.dataAccessExpiresAt,
    missingPermissions: fields.missingPermissions,
    connectedAt: new Date(),
    lastSyncError: null,
    syncStartedAt: null,
    webhookSubscribedAt: fields.webhookSubscribedAt,
  };
}

/** After a Meta account is stored: log it and import profile + posts before the user lands back (the wizard needs them). */
export async function afterMetaConnected(businessId: string, grant: UserGrant, page: PageCandidate, missing: string[]) {
  await logIntegration({
    businessId,
    level: "info",
    call: "oauth.connected",
    message: `Connected @${page.username} (Page "${page.pageName}").${missing.length ? ` Not granted: ${missing.join(", ")}.` : ""}`,
    details: { scopes: grant.info.scopes, missing, tokenExpiresAt: grant.info.expiresAt?.toISOString() ?? null },
  });
  await syncInstagram(businessId, { scope: "basic", reason: "connect" }).catch((e) => console.error("[meta] initial sync failed", (e as Error).message));
}

/** Insights, comments and the DM webhook subscription, right after the response. */
export function afterMetaConnectedDeferred(businessId: string) {
  after(() => syncInstagram(businessId, { scope: "deferred", reason: "connect" }).catch((e) => console.error("[meta] initial sync failed", (e as Error).message)));
  after(() => ensureWebhookSubscription(businessId));
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
  return connectCandidate(ctx, reviveGrant(grant), candidate);
}

/** Step 5: store the connection (encrypted) and import the account. */
async function connectCandidate(ctx: ConnectContext, grant: UserGrant, page: PageCandidate): Promise<{ outcome: MetaConnectOutcome; username?: string }> {
  const { businessId } = ctx;
  const accountKey = metaAccountKey(page.igUserId);

  const elsewhere = await db.instagramConnection.findFirst({ where: { igAccountKey: accountKey, businessId: { not: businessId } }, select: { id: true } });
  const handleTaken = page.username ? await db.business.count({ where: { instagramHandle: page.username, id: { not: businessId } } }) : 0;
  if (elsewhere || handleTaken) {
    await cancelPending(businessId);
    // The same Instagram account can't be added twice — not even to the same login.
    const own = await isOwnOtherAccount(ctx.userId, businessId, { OR: [{ instagramConnection: { igAccountKey: accountKey } }, ...(page.username ? [{ instagramHandle: page.username }] : [])] });
    if (own) return { outcome: await fail(ctx, "already_added", "This Instagram account is already one of the user's accounts.", { username: page.username }) };
    return { outcome: await fail(ctx, "taken", "This Instagram account is already connected to another business.", { username: page.username }) };
  }

  const data = metaConnectionData(grant, page);
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
  await afterMetaConnected(businessId, grant, page, data.missingPermissions);
  // A new sign-up (or added account) is named after the Instagram account: its display name from the sync.
  if (page.username) {
    const profile = await db.instagramConnection.findUnique({ where: { businessId }, select: { profile: true } });
    await adoptInstagramName(businessId, page.username, (profile?.profile as { name?: string | null } | null)?.name);
  }
  afterMetaConnectedDeferred(businessId);
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
