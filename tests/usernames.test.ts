import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loginName, normalizeUsername, parseIdentifier, placeholderEmail, usernameFromPlaceholder, usernameProblem } from "@/lib/usernames";
import { usernameSchema } from "@/lib/validation/auth";

describe("usernameProblem", () => {
  it("accepts letters, numbers, underscore and dot, 3–30 characters, in any case", () => {
    for (const ok of ["abc", "Kbakes", "k_bakes.kw", "user_123", "a".repeat(30), "A.B"]) assert.equal(usernameProblem(ok), null, ok);
  });
  it("names the problem", () => {
    assert.equal(usernameProblem(""), "required");
    assert.equal(usernameProblem("   "), "required");
    assert.equal(usernameProblem("ab"), "too_short");
    assert.equal(usernameProblem("a".repeat(31)), "too_long");
    for (const bad of ["has space", "dash-name", "name@x", "اسم", "emoji😀", "semi;colon"]) assert.equal(usernameProblem(bad), "characters", bad);
  });
});

describe("usernameSchema", () => {
  it("lower-cases and trims; the issue message is the problem code", () => {
    assert.equal(usernameSchema.parse("  Kbakes "), "kbakes");
    const bad = usernameSchema.safeParse("ab");
    assert.ok(!bad.success && bad.error.issues[0].message === "too_short");
  });
});

describe("placeholders and identifiers", () => {
  it("round-trips a username through its internal address", () => {
    assert.equal(placeholderEmail(" KBakes "), "kbakes@users.invalid");
    assert.equal(usernameFromPlaceholder("kbakes@users.invalid"), "kbakes");
    assert.equal(usernameFromPlaceholder("owner@example.com"), null);
    assert.equal(loginName("kbakes@users.invalid"), "kbakes");
    assert.equal(loginName("owner@example.com"), "owner@example.com");
    assert.equal(loginName("x@users.invalid", "named"), "named");
    assert.equal(normalizeUsername(" A_B "), "a_b");
  });
  it("tells an email from a username by the @", () => {
    assert.deepEqual(parseIdentifier(" Admin@Example.com "), { kind: "email", value: "admin@example.com" });
    assert.deepEqual(parseIdentifier(" K.Bakes "), { kind: "username", value: "k.bakes" });
  });
});

describe("resolveIdentity (admin-created accounts)", () => {
  it("username with optional email, or email alone", async () => {
    const { resolveIdentity } = await import("@/lib/usernames");
    assert.deepEqual(resolveIdentity({ username: " Cafe_KW " }), { username: "cafe_kw", email: "cafe_kw@users.invalid" });
    assert.deepEqual(resolveIdentity({ username: "cafe", email: " Owner@Example.com " }), { username: "cafe", email: "owner@example.com" });
    assert.deepEqual(resolveIdentity({ email: "old@example.com" }), { username: null, email: "old@example.com" });
  });
});
