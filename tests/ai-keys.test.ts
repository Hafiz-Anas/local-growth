import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { businessScope, candidateScopes, keyFingerprint, keyLast4, keyProblem, maskedKey, pickKey, planScope, PLATFORM_SCOPE } from "@/lib/services/ai-key-core";

const KEY = (c: string) => `AIza${c.repeat(20)}`;

describe("which key an AI call uses", () => {
  const stored = [
    { scopeKey: PLATFORM_SCOPE, apiKey: KEY("p") },
    { scopeKey: businessScope("b1"), apiKey: KEY("b") },
    { scopeKey: planScope("growth"), apiKey: KEY("g") },
  ];
  it("client key → plan key → platform key → environment", () => {
    assert.equal(pickKey(candidateScopes({ businessId: "b1", plan: "GROWTH" }), stored, KEY("e"))?.source, "business");
    assert.equal(pickKey(candidateScopes({ businessId: "b2", plan: "GROWTH" }), stored, KEY("e"))?.source, "plan");
    assert.equal(pickKey(candidateScopes({ businessId: "b2" }), stored, KEY("e"))?.source, "platform");
    assert.equal(pickKey(candidateScopes({ businessId: "b2" }), [], KEY("e"))?.source, "env");
    assert.equal(pickKey(candidateScopes({ businessId: "b2" }), [], "  "), null);
  });
  it("clearing a client's key goes back to the platform key", () => {
    const withoutClient = stored.filter((s) => s.scopeKey !== businessScope("b1"));
    assert.equal(pickKey(candidateScopes({ businessId: "b1" }), withoutClient, undefined)?.apiKey, KEY("p"));
  });
  it("the fingerprint differs per key and never contains the key", () => {
    const a = keyFingerprint(KEY("a"));
    assert.notEqual(a, keyFingerprint(KEY("b")));
    assert.ok(!a.includes("AIza"));
    assert.equal(pickKey([PLATFORM_SCOPE], stored, undefined)?.fingerprint, keyFingerprint(KEY("p")));
  });
});

describe("key checks and masking", () => {
  it("rejects obviously wrong input", () => {
    assert.equal(keyProblem(""), "empty");
    assert.equal(keyProblem("short"), "too_short");
    assert.equal(keyProblem("has a space inside the key text"), "spaces");
    assert.equal(keyProblem("x".repeat(201)), "too_long");
    assert.equal(keyProblem("é".repeat(25)), "characters");
    assert.equal(keyProblem(`  ${KEY("k")}  `), null);
  });
  it("shows only the last 4 characters", () => {
    assert.equal(keyLast4(`  ${KEY("k")}wxyz `), "wxyz");
    assert.equal(maskedKey("wxyz"), "••••••••wxyz");
  });
});

describe("encryption key guard", () => {
  it("reports a missing or invalid ENCRYPTION_KEY instead of throwing", async () => {
    const { encryptionKeyProblem } = await import("@/lib/crypto");
    const saved = process.env.ENCRYPTION_KEY;
    try {
      delete process.env.ENCRYPTION_KEY;
      assert.equal(encryptionKeyProblem(), "missing");
      process.env.ENCRYPTION_KEY = "dG9vc2hvcnQ=";
      assert.equal(encryptionKeyProblem(), "invalid");
      process.env.ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");
      assert.equal(encryptionKeyProblem(), null);
    } finally {
      if (saved === undefined) delete process.env.ENCRYPTION_KEY;
      else process.env.ENCRYPTION_KEY = saved;
    }
  });
});
