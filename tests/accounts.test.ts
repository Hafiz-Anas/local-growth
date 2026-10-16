import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_PLAN_LIMITS, MAX_INSTAGRAM_ACCOUNTS_LIMIT, PLAN_IDS } from "../config/plans";
import { accountLimitFor, accountMismatch, resolveActiveAccount } from "../lib/accounts";
import { planLimitsSchema } from "../lib/validation/api";

describe("resolveActiveAccount", () => {
  it("keeps the saved account while the user belongs to it", () => {
    assert.equal(resolveActiveAccount("b2", ["b1", "b2"]), "b2");
  });

  it("never returns an account the user doesn't belong to (removed, or someone else's)", () => {
    assert.equal(resolveActiveAccount("other", ["b1", "b2"]), "b1");
    assert.equal(resolveActiveAccount(null, ["b1", "b2"]), "b1");
  });

  it("is null with no accounts", () => {
    assert.equal(resolveActiveAccount("b1", []), null);
    assert.equal(resolveActiveAccount(null, []), null);
  });
});

describe("accountLimitFor", () => {
  it("is 1 per plan by default", () => {
    for (const plan of PLAN_IDS) assert.equal(DEFAULT_PLAN_LIMITS[plan].instagramAccounts, 1, plan);
    assert.equal(accountLimitFor(["starter"], DEFAULT_PLAN_LIMITS), 1);
  });

  it("follows the admin's per-plan setting, taking the highest of the login's plans", () => {
    const limits = { ...DEFAULT_PLAN_LIMITS, growth: { ...DEFAULT_PLAN_LIMITS.growth, instagramAccounts: 3 } };
    assert.equal(accountLimitFor(["starter"], limits), 1);
    assert.equal(accountLimitFor(["starter", "growth"], limits), 3);
  });

  it("is at least 1, even with no accounts", () => {
    assert.equal(accountLimitFor([], DEFAULT_PLAN_LIMITS), 1);
  });
});

describe("accountMismatch", () => {
  it("flags a screen rendered for another account than the active one", () => {
    assert.equal(accountMismatch("b1", "b2"), true);
    assert.equal(accountMismatch("b1", null), true);
  });

  it("passes the same account, and calls that don't say (scripts, forms)", () => {
    assert.equal(accountMismatch("b1", "b1"), false);
    assert.equal(accountMismatch(null, "b1"), false);
    assert.equal(accountMismatch("", "b1"), false);
  });
});

describe("plan limits setting", () => {
  it("accepts Instagram accounts per plan within bounds", () => {
    assert.ok(planLimitsSchema.safeParse({ pro: { instagramAccounts: 5 } }).success);
    assert.ok(!planLimitsSchema.safeParse({ pro: { instagramAccounts: 0 } }).success);
    assert.ok(!planLimitsSchema.safeParse({ pro: { instagramAccounts: MAX_INSTAGRAM_ACCOUNTS_LIMIT + 1 } }).success);
  });
});
