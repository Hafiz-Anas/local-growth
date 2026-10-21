import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { signupSchema } from "@/lib/validation/api";
import { passwordProblems } from "@/lib/validation/password";

/**
 * Sign-up in one page: email + password, then Instagram — the account exists only once Instagram is
 * connected. Pure (the store and the Instagram connect step are injected), tested in tests/signup-flow.test.ts;
 * the Prisma store, Meta/mock connect and sign-in live in lib/server/signup.ts.
 *
 *  1. startSignup     validates as before (format, password rules, email not registered), stores a
 *                     PendingSignup (password HASH only, 15 min, one per email — a second start replaces
 *                     the first) and answers its id + the OAuth state `su.<id>.<nonce>` (the row keeps
 *                     the nonce's SHA-256).
 *  2. finishSignup    Instagram's callback: the cookie's id, the state and the row must match and the row
 *                     must not have expired; a cancel/error creates nothing; then connect Instagram; an
 *                     account already connected elsewhere is refused; only then `createAccount` makes the
 *                     user + business + connection in one transaction and removes the pending row.
 */

export const PENDING_SIGNUP_TTL_MS = 15 * 60 * 1000;
const STATE_PREFIX = "su";

export type SignupField = "email" | "password";
export type SignupStartError = "invalid" | "email_taken";

export interface PendingSignupRecord {
  id: string;
  email: string;
  passwordHash: string;
  language: "en" | "ar";
  stateHash: string;
  expiresAt: Date;
}

/** What Instagram's side of the flow ends with (before any account exists). */
export type SignupFailure = "cancelled" | "not_tester" | "expired" | "error" | "declined" | "no_account" | "taken" | "unavailable" | "email_taken";
export type SignupOutcome = SignupFailure | "connected" | "pick";

/** What Instagram's callback can bring back to /signup (?instagram=…). */
export const SIGNUP_PAGE_OUTCOMES: readonly (SignupFailure | "pick")[] = ["cancelled", "not_tester", "expired", "error", "declined", "no_account", "taken", "unavailable", "email_taken", "pick"];

/** An Instagram account ready to be stored with the new business. `data` is opaque to this module. */
export interface SignupInstagram<C> {
  username: string;
  /** Business name taken from Instagram (display name, else the username made readable). */
  businessName: string;
  data: C;
}

export interface SignupStore<C> {
  emailRegistered(email: string): Promise<boolean>;
  /** Stores the pending sign-up, replacing any other one for the same email. */
  replacePending(record: PendingSignupRecord): Promise<void>;
  findPending(id: string): Promise<PendingSignupRecord | null>;
  /** The Instagram account is already connected to another login. */
  instagramTaken(account: SignupInstagram<C>): Promise<boolean>;
  /**
   * User + business + Instagram connection in one transaction, deleting the pending row in it too.
   * Throws `SignupConflict` when the email or the Instagram account was taken meanwhile (a race), or the
   * pending row is gone (replaced by a newer start for the same email) — "expired".
   */
  createAccount(pending: PendingSignupRecord, account: SignupInstagram<C>): Promise<{ userId: string; businessId: string }>;
}

export class SignupConflict extends Error {
  constructor(readonly reason: "email_taken" | "taken" | "expired") {
    super(reason);
  }
}

// State ----------------------------------------------------------------------------

export const hashNonce = (nonce: string) => createHash("sha256").update(nonce).digest("hex");

export function buildSignupState(id: string, nonce: string) {
  return `${STATE_PREFIX}.${id}.${nonce}`;
}

/** `su.<id>.<nonce>` → its parts; null for any other state (e.g. a signed-in user's connect). */
export function parseSignupState(state: string | null | undefined): { id: string; nonce: string } | null {
  const parts = (state ?? "").split(".");
  if (parts.length !== 3 || parts[0] !== STATE_PREFIX || !/^[A-Za-z0-9_-]{16,64}$/.test(parts[1]) || !/^[A-Za-z0-9_-]{16,128}$/.test(parts[2])) return null;
  return { id: parts[1], nonce: parts[2] };
}

export const isSignupState = (state: string | null | undefined) => parseSignupState(state) !== null;

const equal = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export type SignupCheck =
  | { ok: true; pending: PendingSignupRecord }
  | { ok: false; reason: "missing" | "mismatch" | "expired"; /** For pre-filling the email on /signup. */ pending: PendingSignupRecord | null };

/**
 * The callback's checks: the cookie's pending id, the state Meta sent back and the stored row agree, and
 * the row hasn't expired. Never trusts the state alone (it went through the browser and Meta).
 */
export async function checkSignup<C>(store: SignupStore<C>, input: { cookieId: string | null; state: string | null }, now = new Date()): Promise<SignupCheck> {
  // Only this browser's own row is ever loaded (and handed back for the form), never the state's.
  const pending = input.cookieId ? await store.findPending(input.cookieId) : null;
  const parsed = parseSignupState(input.state);
  if (!parsed || !pending) return { ok: false, reason: "missing", pending };
  if (!equal(parsed.id, pending.id) || !equal(hashNonce(parsed.nonce), pending.stateHash)) return { ok: false, reason: "mismatch", pending };
  if (pending.expiresAt <= now) return { ok: false, reason: "expired", pending };
  return { ok: true, pending };
}

// Start ----------------------------------------------------------------------------

export type StartResult = { ok: true; id: string; state: string; email: string } | { ok: false; error: SignupStartError; fields: SignupField[] };

/** Step 1: the same checks as before; nothing but the pending row is written. */
export async function startSignup<C>(
  store: SignupStore<C>,
  raw: { email: string; password: string; language: "en" | "ar" },
  deps: { hashPassword: (password: string) => Promise<string>; now?: Date; random?: (bytes: number) => string },
): Promise<StartResult> {
  const parsed = signupSchema.safeParse({ email: raw.email, password: raw.password });
  const weak = passwordProblems(raw.password, { email: raw.email, name: "" }).length > 0;
  if (!parsed.success || weak) {
    const fields = new Set<SignupField>(parsed.success ? [] : parsed.error.issues.map((i) => i.path[0] as SignupField));
    if (weak) fields.add("password");
    return { ok: false, error: "invalid", fields: [...fields] };
  }
  const { email, password } = parsed.data;
  if (await store.emailRegistered(email)) return { ok: false, error: "email_taken", fields: ["email"] };

  const random = deps.random ?? ((bytes: number) => randomBytes(bytes).toString("base64url"));
  const id = random(18);
  const nonce = random(24);
  await store.replacePending({
    id,
    email,
    passwordHash: await deps.hashPassword(password),
    language: raw.language,
    stateHash: hashNonce(nonce),
    expiresAt: new Date((deps.now ?? new Date()).getTime() + PENDING_SIGNUP_TTL_MS),
  });
  return { ok: true, id, state: buildSignupState(id, nonce), email };
}

// Finish ---------------------------------------------------------------------------

/** What connecting Instagram gave: an account, several to pick from, or a failure. */
export type ConnectResult<C> = { kind: "account"; account: SignupInstagram<C> } | { kind: "pick" } | { kind: "failed"; outcome: SignupFailure };

export type FinishResult =
  | { outcome: "connected"; userId: string; businessId: string; username: string }
  | { outcome: "pick"; pending: PendingSignupRecord }
  | { outcome: SignupFailure; pending: PendingSignupRecord | null };

/**
 * Step 2, Instagram's callback. `error` is what Meta (or the demo dialog) sent instead of a code
 * (`not_tester` when Meta refused because the app is in development mode). Nothing is created unless
 * every check passes and Instagram connected.
 */
export async function finishSignup<C>(
  store: SignupStore<C>,
  input: { cookieId: string | null; state: string | null; error: SignupFailure | null; connect: (pending: PendingSignupRecord) => Promise<ConnectResult<C>> },
  now = new Date(),
): Promise<FinishResult> {
  const check = await checkSignup(store, input, now);
  // Missing: the row is gone (replaced by a newer start, used, or removed after expiry) or the cookie is.
  if (!check.ok) return { outcome: check.reason === "mismatch" ? "error" : "expired", pending: check.pending };
  if (input.error) return { outcome: input.error, pending: check.pending };

  const result = await input.connect(check.pending);
  if (result.kind === "pick") return { outcome: "pick", pending: check.pending };
  if (result.kind === "failed") return { outcome: result.outcome, pending: check.pending };
  return completeSignup(store, check.pending, result.account, now);
}

/** Creates the account for a connected Instagram account (also after the picker). */
export async function completeSignup<C>(store: SignupStore<C>, pending: PendingSignupRecord, account: SignupInstagram<C>, now = new Date()): Promise<FinishResult> {
  if (pending.expiresAt <= now) return { outcome: "expired", pending };
  if (await store.instagramTaken(account)) return { outcome: "taken", pending };
  try {
    const created = await store.createAccount(pending, account);
    return { outcome: "connected", ...created, username: account.username };
  } catch (error) {
    if (error instanceof SignupConflict) return { outcome: error.reason, pending };
    throw error;
  }
}

// Meta's development mode -----------------------------------------------------------

/**
 * Meta refused because the app is in development mode and the person isn't one of its testers. Meta has
 * no dedicated error code for this; it shows up as "App not active" / "development mode" / app-role
 * wording in the redirect's error_message or a Graph error.
 */
export function isDevModeRefusal(text: string | null | undefined): boolean {
  if (!text) return false;
  return /app (is )?not active|isn'?t active|not currently accessible|in development mode|development mode|app roles?|tester|not available to this user|isn'?t available/i.test(text);
}
