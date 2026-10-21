import "server-only";
import { cookies, headers } from "next/headers";
import { CredentialsSignin } from "next-auth";
import { signIn } from "@/auth";
import { COOKIES } from "@/config/site";
import { hashPassword } from "@/lib/auth/password";
import { getSession } from "@/lib/auth/server";
import { signupTicket } from "@/lib/auth/signup-ticket";
import { decrypt, encrypt } from "@/lib/crypto";
import { displayNameFromHandle, nameFromEmail } from "@/lib/display-names";
import { db } from "@/lib/db";
import { Prisma, type Plan } from "@/lib/generated/prisma/client";
import {
  completeSignup,
  finishSignup,
  isDevModeRefusal,
  PENDING_SIGNUP_TTL_MS,
  SignupConflict,
  startSignup,
  type ConnectResult,
  type FinishResult,
  type PendingSignupRecord,
  type SignupFailure,
  type SignupInstagram,
  type SignupStore,
  type StartResult,
} from "@/lib/signup-flow";
import { EmailSendError } from "@/lib/services/email";
import { getInstagramService } from "@/lib/services/instagram";
import { buildDialogUrl, connectFlow, getMetaConfig } from "@/lib/services/meta/config";
import { toPageOption, type PageCandidate } from "@/lib/services/meta/mappers";
import { handleSchema } from "@/lib/validation/api";
import type { MetaPageOptionDto } from "@/types";
import { logActivity } from "./activity";
import { rememberLogin } from "./device-logins";
import { sendVerificationEmail } from "./email-verification";
import { logIntegration } from "./integration-log";
import { afterMetaConnected, afterMetaConnectedDeferred, grantAndPages, metaAccountKey, metaConnectionData, reviveGrant, type UserGrant } from "./meta-connect";
import { recordEvent } from "./onboarding";
import { presetRows } from "./permissions";
import { getSelfSignupPlan } from "./settings";

/**
 * Public sign-up, one page (/signup): email + password, then "Continue with Instagram". The user and the
 * business are created together only once Instagram is connected (decisions in lib/signup-flow.ts):
 *
 *  - startInstagramSignup   validates, stores a PendingSignup (password hash only, 15 min, one per email),
 *                           puts only its id in a short-lived encrypted httpOnly cookie and in the OAuth
 *                           state, and answers where the browser goes: Facebook Login (INSTAGRAM_PROVIDER=meta)
 *                           or the demo Instagram screen (/signup/demo-instagram, mock).
 *  - finishInstagramSignup  /api/integrations/instagram/callback (and the token route) for a sign-up state:
 *                           checks, connects, refuses an account connected elsewhere, creates user + business +
 *                           connection in one transaction (named after Instagram), signs in, → /onboarding.
 *                           Cancel / error / expired → /signup?instagram=<outcome>, nothing created, the email
 *                           still filled in (the cookie keeps pointing at the pending row).
 *  - several Instagram accounts → the picker on /signup (GET/POST/DELETE /api/signup/pending).
 * Expired rows are removed by the daily cron (purgeExpiredSignups).
 */

export const SIGNUP_COOKIE = "lge_signup";

const signupCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: PENDING_SIGNUP_TTL_MS / 1000,
};

type SignupConnection =
  | { kind: "mock"; igUserId: string; accessToken: string; expiresAt: Date }
  | { kind: "meta"; grant: UserGrant; page: PageCandidate };

const PENDING_SELECT = { id: true, email: true, passwordHash: true, language: true, stateHash: true, expiresAt: true } as const;

const toRecord = (row: { id: string; email: string; passwordHash: string; language: string; stateHash: string; expiresAt: Date }): PendingSignupRecord => ({
  ...row,
  language: row.language === "ar" ? "ar" : "en",
});

function connectionData(data: SignupConnection) {
  if (data.kind === "meta") return metaConnectionData(data.grant, data.page);
  const now = new Date();
  return {
    provider: "MOCK" as const,
    status: "CONNECTED" as const,
    igUserId: data.igUserId,
    username: null as string | null,
    accessTokenEncrypted: encrypt(data.accessToken),
    tokenExpiresAt: data.expiresAt,
    missingPermissions: [],
    connectedAt: now,
    lastSyncAt: now,
  };
}

export const signupStore: SignupStore<SignupConnection> = {
  async emailRegistered(email) {
    return Boolean(await db.user.findUnique({ where: { email }, select: { id: true } }));
  },
  async replacePending(record) {
    // One pending sign-up per email: starting again replaces the older one (its cookie/state stop matching).
    const data = { ...record, credentialsEncrypted: null, options: Prisma.DbNull, createdAt: new Date() };
    await db.pendingSignup.upsert({ where: { email: record.email }, create: data, update: data });
  },
  async findPending(id) {
    const row = await db.pendingSignup.findUnique({ where: { id }, select: PENDING_SELECT });
    return row && toRecord(row);
  },
  async instagramTaken(account) {
    const handle = await db.business.count({ where: { instagramHandle: account.username } });
    if (handle || account.data.kind !== "meta") return handle > 0;
    return (await db.instagramConnection.count({ where: { igAccountKey: metaAccountKey(account.data.page.igUserId) } })) > 0;
  },
  async createAccount(pending, account) {
    const plan = await getSelfSignupPlan();
    const connection = connectionData(account.data);
    try {
      return await db.$transaction(async (tx) => {
        // Replaced (the same email started again) or already used meanwhile: this attempt is over.
        if ((await tx.pendingSignup.deleteMany({ where: { id: pending.id } })).count !== 1) throw new SignupConflict("expired");
        const business = await tx.business.create({
          data: {
            name: account.businessName,
            instagramHandle: account.username,
            location: "",
            plan: plan.toUpperCase() as Plan,
            source: "SELF_SIGNUP",
            onboardingStatus: "IN_PROGRESS",
            onboardingStep: 1,
            permissions: { create: presetRows(plan) },
            brandVoice: { create: { defaultHashtags: [], brandWords: [], wordsToAvoid: [] } },
            instagramConnection: { create: { ...connection, username: account.username } },
          },
          select: { id: true },
        });
        const user = await tx.user.create({
          data: {
            email: pending.email,
            name: nameFromEmail(pending.email),
            passwordHash: pending.passwordHash,
            role: "USER",
            businessId: business.id,
            memberships: { create: { businessId: business.id } },
            uiPreferences: { sidebarCollapsed: false, theme: "dark", language: pending.language },
          },
          select: { id: true },
        });
        const provider = account.data.kind;
        await logActivity({ businessId: business.id, userId: user.id, action: "business.self_signup", details: { plan } }, tx);
        await logActivity({ businessId: business.id, userId: user.id, action: "instagram.connected", details: { username: account.username, provider } }, tx);
        await recordEvent(business.id, "signup", "completed", { details: { plan } }, tx);
        await recordEvent(business.id, "instagram", "completed", { details: { provider } }, tx);
        return { userId: user.id, businessId: business.id };
      });
    } catch (error) {
      // Two sign-ups racing for the same email or Instagram account.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const target = JSON.stringify(error.meta ?? {});
        throw new SignupConflict(target.includes("email") ? "email_taken" : "taken");
      }
      throw error;
    }
  },
};

// Cookie -----------------------------------------------------------------------------

async function readSignupCookie(): Promise<string | null> {
  const value = (await cookies()).get(SIGNUP_COOKIE)?.value;
  if (!value) return null;
  try {
    return decrypt(value);
  } catch {
    return null;
  }
}

async function setSignupCookie(id: string) {
  (await cookies()).set(SIGNUP_COOKIE, encrypt(id), signupCookieOptions);
}

async function clearSignupCookie() {
  (await cookies()).set(SIGNUP_COOKIE, "", { ...signupCookieOptions, maxAge: 0 });
}

/** What /signup shows: the email of this browser's pending sign-up (even expired), and whether a picker is open. */
export async function signupPageState(): Promise<{ email: string; picking: boolean }> {
  const id = await readSignupCookie();
  const row = id ? await db.pendingSignup.findUnique({ where: { id }, select: { email: true, options: true, expiresAt: true } }) : null;
  return { email: row?.email ?? "", picking: Boolean(row?.options && row.expiresAt > new Date()) };
}

// Start ------------------------------------------------------------------------------

export type StartSignupResult = Exclude<StartResult, { ok: true }> | { ok: true; redirectTo: string } | { ok: false; error: "unavailable"; fields: [] };

/** Step 1 (the sign-up form's server action). Nothing but the pending row is written. */
export async function startInstagramSignup(raw: { email: string; password: string; language: "en" | "ar" }): Promise<StartSignupResult> {
  const flow = connectFlow();
  const config = flow === "meta" ? getMetaConfig() : null;
  if (flow === "meta_unavailable" || (flow === "meta" && !config)) return { ok: false, error: "unavailable", fields: [] };

  const started = await startSignup(signupStore, raw, { hashPassword });
  if (!started.ok) return started;
  await setSignupCookie(started.id);
  const redirectTo = config ? buildDialogUrl(config, started.state, { rerequest: false }) : `/signup/demo-instagram?${new URLSearchParams({ state: started.state })}`;
  return { ok: true, redirectTo };
}

// Finish -----------------------------------------------------------------------------

export interface SignupCallback {
  state: string | null;
  /** Meta's authorization code (code mode). */
  code?: string | null;
  /** Token mode: the fragment's tokens. */
  token?: { accessToken: string; longLivedToken: string | null } | null;
  /** The demo Instagram screen (INSTAGRAM_PROVIDER=mock): the handle "logged in". */
  mockHandle?: string | null;
  /** Meta (or the demo screen) sent an error instead: cancelled, or refused. */
  error?: string | null;
  /** error_message / error_description, to tell a development-mode refusal from a cancel. */
  errorText?: string | null;
}

const failureOf = (error: string | null | undefined, errorText: string | null | undefined): SignupFailure | null => {
  if (!error) return null;
  return isDevModeRefusal(`${error} ${errorText ?? ""}`) ? "not_tester" : "cancelled";
};

/** Step 2: Instagram's callback for a sign-up. Answers where the browser goes next. */
export async function finishInstagramSignup(input: SignupCallback): Promise<string> {
  let account: SignupInstagram<SignupConnection> | null = null;
  const result = await finishSignup(signupStore, {
    cookieId: await readSignupCookie(),
    state: input.state,
    error: failureOf(input.error, input.errorText),
    connect: async (pending) => {
      const connected = await connectInstagram(pending, input);
      if (connected.kind === "account") account = connected.account;
      return connected;
    },
  });
  return settle(result, input.error ? (input.errorText ?? input.error) : null, account);
}

async function connectInstagram(pending: PendingSignupRecord, input: SignupCallback): Promise<ConnectResult<SignupConnection>> {
  const flow = connectFlow();
  if (flow === "mock") {
    const handle = handleSchema.safeParse(input.mockHandle ?? "");
    if (!handle.success) return { kind: "failed", outcome: "error" };
    const connected = await getInstagramService()
      .connectAccount({ businessId: pending.id, handle: handle.data })
      .catch((error) => {
        console.error("[signup] mock connectAccount failed", error);
        return null;
      });
    if (!connected) return { kind: "failed", outcome: "error" };
    return {
      kind: "account",
      account: { username: handle.data, businessName: businessNameFrom(handle.data, null), data: { kind: "mock", igUserId: connected.igUserId, accessToken: connected.accessToken, expiresAt: connected.expiresAt } },
    };
  }
  if (flow !== "meta") return { kind: "failed", outcome: "unavailable" };

  const source = input.code ? { code: input.code } : input.token ? { token: input.token.accessToken, longLived: input.token.longLivedToken } : null;
  if (!source) return { kind: "failed", outcome: "error" };
  const result = await grantAndPages(null, source);
  if (!result.ok) {
    await logIntegration({ businessId: null, level: "warning", call: "oauth.signup", errorCode: result.outcome, message: result.message, details: result.details ?? {} });
    return { kind: "failed", outcome: result.outcome };
  }
  if (result.candidates.length === 1) return { kind: "account", account: metaAccount(result.grant, result.candidates[0]) };

  // Several Instagram accounts: the picker on /signup chooses (tokens stay encrypted on the pending row).
  await db.pendingSignup.update({
    where: { id: pending.id },
    data: { credentialsEncrypted: encrypt(JSON.stringify({ grant: result.grant, candidates: result.candidates })), options: result.candidates.map(toPageOption) as unknown as Prisma.InputJsonArray },
  });
  return { kind: "pick" };
}

const businessNameFrom = (username: string, displayName: string | null | undefined) => displayName?.replace(/\s+/g, " ").trim().slice(0, 120) || displayNameFromHandle(username) || username;

function metaAccount(grant: UserGrant, page: PageCandidate): SignupInstagram<SignupConnection> {
  return { username: page.username, businessName: businessNameFrom(page.username, page.name), data: { kind: "meta", grant, page } };
}

/**
 * Turns the outcome into the next page. Connected: sign in (ticket, never the password), remember the
 * login on this device, send the verification email, import the Instagram account (Meta) → onboarding.
 * Anything else: nothing was created; back to /signup with the email still filled in.
 */
async function settle(result: FinishResult, reason: string | null, account: SignupInstagram<SignupConnection> | null = null): Promise<string> {
  // Signed in ("Add account" → "Create a new account"): back to the sign-up page proxy.ts lets them open.
  const back = async (outcome: string) => `/signup?instagram=${outcome}${(await getSession()) ? "&add=1" : ""}`;
  if (result.outcome === "pick") return back("pick");
  if (result.outcome !== "connected") {
    if (result.outcome !== "cancelled") {
      await logIntegration({ businessId: null, level: result.outcome === "error" ? "warning" : "info", call: "oauth.signup", errorCode: result.outcome, message: `Sign-up didn't connect Instagram (${result.outcome}).${reason ? ` ${reason}` : ""}` });
    }
    // Keep pointing at the pending row (its email fills the form again) for another 15 minutes.
    if (result.pending) await setSignupCookie(result.pending.id);
    else await clearSignupCookie();
    return back(result.outcome);
  }

  await clearSignupCookie();
  const store = await cookies();
  store.delete(COOKIES.preview);
  try {
    await signIn("signup", { ticket: signupTicket(result.userId), redirect: false });
  } catch (error) {
    // The account exists; if signing in fails, they log in with their password.
    if (error instanceof CredentialsSignin) return "/login";
    throw error;
  }
  await rememberLogin(result.userId);

  if (account?.data.kind === "meta") {
    // Profile + posts now (the wizard reads them); insights, comments and webhooks after the response.
    const { grant, page } = account.data;
    await afterMetaConnected(result.businessId, grant, page, metaConnectionData(grant, page).missingPermissions);
    afterMetaConnectedDeferred(result.businessId);
  }

  // A failed email shouldn't undo the account — the banner says so and offers "Resend".
  await sendVerificationEmail(result.userId, await appOrigin()).catch((error) => {
    if (!(error instanceof EmailSendError)) console.error("[signup] verification email failed", error);
  });
  return "/onboarding";
}

/** Email links are built from AUTH_URL (as everywhere), else this request's host. */
async function appOrigin() {
  const requestHeaders = await headers();
  return process.env.AUTH_URL ?? `${requestHeaders.get("x-forwarded-proto") ?? "http"}://${requestHeaders.get("host")}`;
}

// Picker (several Instagram accounts) -------------------------------------------------

async function pendingWithChoices() {
  const id = await readSignupCookie();
  const row = id ? await db.pendingSignup.findUnique({ where: { id }, select: { ...PENDING_SELECT, options: true, credentialsEncrypted: true } }) : null;
  if (!row || !row.credentialsEncrypted || row.expiresAt <= new Date()) return null;
  return row;
}

/** The accounts to pick from (no tokens); null when there is no open choice. */
export async function signupChoices(): Promise<MetaPageOptionDto[] | null> {
  const row = await pendingWithChoices();
  return row ? (row.options as unknown as MetaPageOptionDto[]) : null;
}

/** The person picked one: create the account with it. */
export async function pickSignupAccount(pageId: string): Promise<{ outcome: FinishResult["outcome"]; redirectTo: string }> {
  const row = await pendingWithChoices();
  if (!row) return { outcome: "expired", redirectTo: await settle({ outcome: "expired", pending: null }, "The account choice expired.") };
  const { grant, candidates } = JSON.parse(decrypt(row.credentialsEncrypted!)) as { grant: UserGrant; candidates: PageCandidate[] };
  const page = candidates.find((c) => c.pageId === pageId);
  const pending = toRecord(row);
  if (!page) return { outcome: "error", redirectTo: await settle({ outcome: "error", pending }, "The picked Page isn't one of the options.") };
  const account = metaAccount(reviveGrant(grant), page);
  const result = await completeSignup(signupStore, pending, account);
  return { outcome: result.outcome, redirectTo: await settle(result, null, account) };
}

/** The person closed the picker: forget the tokens, keep the email for the form. */
export async function cancelSignupChoice(): Promise<void> {
  const id = await readSignupCookie();
  if (id) await db.pendingSignup.updateMany({ where: { id }, data: { credentialsEncrypted: null, options: Prisma.DbNull } });
}

// Cron -------------------------------------------------------------------------------

/** Daily cron: sign-ups that never connected Instagram. */
export async function purgeExpiredSignups(): Promise<number> {
  return (await db.pendingSignup.deleteMany({ where: { expiresAt: { lt: new Date() } } })).count;
}
