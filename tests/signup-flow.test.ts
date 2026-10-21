import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  PENDING_SIGNUP_TTL_MS,
  SIGNUP_PAGE_OUTCOMES,
  SignupConflict,
  buildSignupState,
  checkSignup,
  completeSignup,
  finishSignup,
  isDevModeRefusal,
  isSignupState,
  parseSignupState,
  startSignup,
  type ConnectResult,
  type PendingSignupRecord,
  type SignupInstagram,
  type SignupStore,
} from "../lib/signup-flow";

/**
 * Sign-up in one page (lib/signup-flow.ts): nothing but a pending row exists until Instagram connects.
 * An in-memory store stands in for Prisma (lib/server/signup.ts).
 */

type Account = { igId: string };

class MemoryStore implements SignupStore<Account> {
  pending = new Map<string, PendingSignupRecord>();
  users: { id: string; email: string; passwordHash: string; businessId: string; handle: string; businessName: string }[] = [];
  takenHandles = new Set<string>();
  /** Simulates a race: the next createAccount fails with this. */
  conflict: SignupConflict | null = null;

  async emailRegistered(email: string) {
    return this.users.some((u) => u.email === email);
  }
  async replacePending(record: PendingSignupRecord) {
    for (const [id, row] of this.pending) if (row.email === record.email) this.pending.delete(id);
    this.pending.set(record.id, { ...record });
  }
  async findPending(id: string) {
    return this.pending.get(id) ?? null;
  }
  async instagramTaken(account: SignupInstagram<Account>) {
    return this.takenHandles.has(account.username) || this.users.some((u) => u.handle === account.username);
  }
  async createAccount(pending: PendingSignupRecord, account: SignupInstagram<Account>) {
    if (this.conflict) throw this.conflict;
    if (!this.pending.delete(pending.id)) throw new SignupConflict("expired");
    const user = { id: `u${this.users.length + 1}`, email: pending.email, passwordHash: pending.passwordHash, businessId: `b${this.users.length + 1}`, handle: account.username, businessName: account.businessName };
    this.users.push(user);
    return { userId: user.id, businessId: user.businessId };
  }
}

const PASSWORD = "Growth2026!";
let counter = 0;
const deps = {
  hashPassword: async (p: string) => `hash(${p})`,
  random: (bytes: number) => `r${String(++counter).padStart(4, "0")}`.padEnd(bytes, "x"),
};
const NOW = new Date("2026-10-21T10:00:00Z");
const later = (ms: number) => new Date(NOW.getTime() + ms);

const account = (username = "kbakes"): SignupInstagram<Account> => ({ username, businessName: "Kbakes", data: { igId: `ig-${username}` } });
const connected = (username?: string) => async (): Promise<ConnectResult<Account>> => ({ kind: "account", account: account(username) });

async function started(store: MemoryStore, email = "owner@example.com") {
  const result = await startSignup(store, { email, password: PASSWORD, language: "en" }, { ...deps, now: NOW });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("not started");
  return result;
}

describe("startSignup: validation", () => {
  it("rejects a bad email and a weak password with the same fields as before, and stores nothing", async () => {
    const store = new MemoryStore();
    const bad = await startSignup(store, { email: "not-an-email", password: PASSWORD, language: "en" }, deps);
    assert.deepEqual(bad, { ok: false, error: "invalid", fields: ["email"] });
    const weak = await startSignup(store, { email: "a@example.com", password: "short", language: "en" }, deps);
    assert.equal(weak.ok, false);
    assert.ok(!weak.ok && weak.fields.includes("password"));
    const personal = await startSignup(store, { email: "kbakes@example.com", password: "kbakes2026", language: "en" }, deps);
    assert.ok(!personal.ok && personal.fields.includes("password"));
    assert.equal(store.pending.size, 0);
  });

  it("refuses an email that already has an account", async () => {
    const store = new MemoryStore();
    store.users.push({ id: "u0", email: "owner@example.com", passwordHash: "x", businessId: "b0", handle: "old", businessName: "Old" });
    const result = await startSignup(store, { email: " Owner@Example.com ", password: PASSWORD, language: "en" }, deps);
    assert.deepEqual(result, { ok: false, error: "email_taken", fields: ["email"] });
    assert.equal(store.pending.size, 0);
  });

  it("stores only the password hash, the state's hash and a 15-minute expiry — no user", async () => {
    const store = new MemoryStore();
    const result = await started(store, "Owner@Example.com");
    const row = store.pending.get(result.id)!;
    assert.equal(row.email, "owner@example.com");
    assert.equal(row.passwordHash, `hash(${PASSWORD})`);
    assert.ok(!JSON.stringify(row).includes(`"${PASSWORD}"`));
    assert.equal(row.expiresAt.getTime() - NOW.getTime(), PENDING_SIGNUP_TTL_MS);
    const state = parseSignupState(result.state)!;
    assert.equal(state.id, result.id);
    assert.notEqual(row.stateHash, state.nonce);
    assert.equal(store.users.length, 0);
  });

  it("the same email starting twice replaces the older pending sign-up", async () => {
    const store = new MemoryStore();
    const first = await started(store);
    const second = await started(store);
    assert.notEqual(first.id, second.id);
    assert.equal(store.pending.size, 1);
    assert.ok(store.pending.has(second.id));
    // The older attempt's callback no longer works…
    const old = await finishSignup(store, { cookieId: first.id, state: first.state, error: null, connect: connected() }, NOW);
    assert.equal(old.outcome, "expired");
    assert.equal(store.users.length, 0);
    // …the newer one does.
    const fresh = await finishSignup(store, { cookieId: second.id, state: second.state, error: null, connect: connected() }, NOW);
    assert.equal(fresh.outcome, "connected");
  });
});

describe("signup state", () => {
  it("parses only sign-up states", () => {
    const state = buildSignupState("a".repeat(24), "b".repeat(32));
    assert.deepEqual(parseSignupState(state), { id: "a".repeat(24), nonce: "b".repeat(32) });
    assert.equal(isSignupState(state), true);
    for (const other of [null, "", "random-connect-state", `su.${"a".repeat(24)}`, `xx.${"a".repeat(24)}.${"b".repeat(32)}`, `su.short.${"b".repeat(32)}`, `su.${"a".repeat(24)}.${"b".repeat(32)}.extra`]) {
      assert.equal(isSignupState(other), false, String(other));
    }
  });
});

describe("finishSignup: Instagram's callback", () => {
  it("creates nothing before the callback, and the user + business only once Instagram connected", async () => {
    const store = new MemoryStore();
    const s = await started(store);
    assert.equal(store.users.length, 0);
    let connectCalls = 0;
    const result = await finishSignup(
      store,
      {
        cookieId: s.id,
        state: s.state,
        error: null,
        connect: async () => {
          connectCalls++;
          assert.equal(store.users.length, 0, "no user while Instagram connects");
          return { kind: "account", account: account() };
        },
      },
      later(60_000),
    );
    assert.equal(connectCalls, 1);
    assert.equal(result.outcome, "connected");
    assert.equal(store.users.length, 1);
    assert.deepEqual(
      { email: store.users[0].email, passwordHash: store.users[0].passwordHash, handle: store.users[0].handle, businessName: store.users[0].businessName },
      { email: "owner@example.com", passwordHash: `hash(${PASSWORD})`, handle: "kbakes", businessName: "Kbakes" },
    );
    assert.equal(store.pending.size, 0, "the pending row is deleted");
    // Replaying the callback creates nothing more.
    const replay = await finishSignup(store, { cookieId: s.id, state: s.state, error: null, connect: connected() }, later(60_000));
    assert.equal(replay.outcome, "expired");
    assert.equal(store.users.length, 1);
  });

  it("refuses a state that doesn't match the cookie or the stored row", async () => {
    const store = new MemoryStore();
    const a = await started(store, "a@example.com");
    const b = await started(store, "b@example.com");
    const nonce = parseSignupState(a.state)!.nonce;
    const cases = [
      { cookieId: a.id, state: b.state }, // someone else's state
      { cookieId: b.id, state: a.state }, // cookie of another sign-up
      { cookieId: a.id, state: buildSignupState(a.id, nonce.replace(/.$/, "Z")) }, // tampered nonce
    ];
    for (const input of cases) {
      let connectCalled = false;
      const result = await finishSignup(store, { ...input, error: null, connect: async () => ((connectCalled = true), { kind: "account", account: account() }) }, NOW);
      assert.equal(result.outcome, "error");
      assert.equal(connectCalled, false);
    }
    // A mismatch never hands back another person's pending row (its email would fill the form).
    const leaked = await checkSignup(store, { cookieId: a.id, state: b.state }, NOW);
    assert.equal(leaked.ok, false);
    assert.equal(leaked.pending?.email ?? null, "a@example.com");
    assert.equal(store.users.length, 0);
  });

  it("without the cookie or with an unknown id nothing happens", async () => {
    const store = new MemoryStore();
    const s = await started(store);
    const noCookie = await finishSignup(store, { cookieId: null, state: s.state, error: null, connect: connected() }, NOW);
    assert.equal(noCookie.outcome, "expired");
    assert.equal(noCookie.pending, null);
    const noState = await finishSignup(store, { cookieId: s.id, state: null, error: null, connect: connected() }, NOW);
    assert.equal(noState.outcome, "expired");
    assert.equal(store.users.length, 0);
  });

  it("an expired pending sign-up creates nothing (and keeps the email for the form)", async () => {
    const store = new MemoryStore();
    const s = await started(store);
    const result = await finishSignup(store, { cookieId: s.id, state: s.state, error: null, connect: connected() }, later(PENDING_SIGNUP_TTL_MS + 1));
    assert.equal(result.outcome, "expired");
    assert.equal(result.pending?.email, "owner@example.com");
    assert.equal(store.users.length, 0);
    // Exactly at the expiry it's over too.
    const edge = await checkSignup(store, { cookieId: s.id, state: s.state }, later(PENDING_SIGNUP_TTL_MS));
    assert.deepEqual(edge.ok ? "ok" : edge.reason, "expired");
  });

  it("cancel or an error on Meta creates nothing; the same sign-up can try again", async () => {
    const store = new MemoryStore();
    const s = await started(store);
    for (const error of ["cancelled", "not_tester"] as const) {
      let connectCalled = false;
      const result = await finishSignup(store, { cookieId: s.id, state: s.state, error, connect: async () => ((connectCalled = true), { kind: "account", account: account() }) }, NOW);
      assert.equal(result.outcome, error);
      assert.equal(result.pending?.email, "owner@example.com");
      assert.equal(connectCalled, false);
    }
    // Failures while connecting (Meta errors, no business account, declined permissions).
    for (const outcome of ["error", "no_account", "declined", "not_tester"] as const) {
      const result = await finishSignup(store, { cookieId: s.id, state: s.state, error: null, connect: async () => ({ kind: "failed", outcome }) }, NOW);
      assert.equal(result.outcome, outcome);
    }
    assert.equal(store.users.length, 0);
    assert.equal(store.pending.size, 1);
    const retry = await finishSignup(store, { cookieId: s.id, state: s.state, error: null, connect: connected() }, NOW);
    assert.equal(retry.outcome, "connected");
  });

  it("refuses an Instagram account already connected to another login", async () => {
    const store = new MemoryStore();
    store.takenHandles.add("kbakes");
    const s = await started(store);
    const result = await finishSignup(store, { cookieId: s.id, state: s.state, error: null, connect: connected("kbakes") }, NOW);
    assert.equal(result.outcome, "taken");
    assert.equal(store.users.length, 0);

    // An account another sign-up has just created is taken too.
    const other = await started(store, "other@example.com");
    assert.equal((await finishSignup(store, { cookieId: other.id, state: other.state, error: null, connect: connected("salmiya.sweets") }, NOW)).outcome, "connected");
    const third = await started(store, "third@example.com");
    assert.equal((await finishSignup(store, { cookieId: third.id, state: third.state, error: null, connect: connected("salmiya.sweets") }, NOW)).outcome, "taken");
    assert.equal(store.users.length, 1);
  });

  it("maps races in the transaction to a clear outcome", async () => {
    const store = new MemoryStore();
    for (const reason of ["taken", "email_taken"] as const) {
      const s = await started(store);
      store.conflict = new SignupConflict(reason);
      const result = await finishSignup(store, { cookieId: s.id, state: s.state, error: null, connect: connected() }, NOW);
      assert.equal(result.outcome, reason);
    }
    assert.equal(store.users.length, 0);
  });

  it("several Instagram accounts: waits for the pick, then creates the account", async () => {
    const store = new MemoryStore();
    const s = await started(store);
    const result = await finishSignup(store, { cookieId: s.id, state: s.state, error: null, connect: async () => ({ kind: "pick" }) }, NOW);
    assert.equal(result.outcome, "pick");
    assert.equal(store.users.length, 0);
    const pending = store.pending.get(s.id)!;
    assert.equal((await completeSignup(store, pending, account("second.account"), later(PENDING_SIGNUP_TTL_MS + 1))).outcome, "expired");
    const picked = await completeSignup(store, pending, account("second.account"), NOW);
    assert.equal(picked.outcome, "connected");
    assert.equal(store.users[0].handle, "second.account");
  });
});

describe("isDevModeRefusal", () => {
  it("recognises Meta's development-mode refusals, not ordinary cancels", () => {
    for (const text of ["App not active: This app is not currently accessible", "The app is in development mode", "(#200) The user must have a role on the app (tester)", "Feature isn't available"]) {
      assert.equal(isDevModeRefusal(text), true, text);
    }
    for (const text of [null, "", "access_denied user_denied", "Permissions error", "Invalid OAuth access token"]) {
      assert.equal(isDevModeRefusal(text), false, String(text));
    }
  });
});

describe("copy", () => {
  it("every outcome /signup can show has EN and AR text", () => {
    for (const lang of ["en", "ar"]) {
      const json = JSON.parse(readFileSync(`locales/${lang}.json`, "utf8"));
      for (const outcome of SIGNUP_PAGE_OUTCOMES.filter((o) => o !== "pick")) assert.equal(typeof json.signup.instagram[outcome], "string", `${lang} ${outcome}`);
      for (const key of ["submit", "redirecting", "instagramHint"]) assert.equal(typeof json.signup[key], "string", `${lang} signup.${key}`);
      for (const key of ["title", "body", "allow", "cancel"]) assert.equal(typeof json.signup.demo[key], "string", `${lang} signup.demo.${key}`);
      assert.equal(typeof json.instagramConnect.outcomes.not_tester, "string");
    }
  });
});
