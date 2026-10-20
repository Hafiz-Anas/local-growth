import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEVICE_LOGINS_COOKIE,
  MAX_DEVICE_LOGINS,
  cookieFromHeader,
  deviceLoginKey,
  openDeviceLogins,
  rememberedLoginProblem,
  sealDeviceLogins,
  tokenHash,
  tokenMatches,
  touched,
  withLogin,
  withoutUser,
  type DeviceLogin,
} from "../lib/device-logins";

const KEY = deviceLoginKey("test-secret");
const login = (n: number, a = n): DeviceLogin => ({ i: `rl${n}`, u: `u${n}`, t: `token-${n}`, a });

describe("sealed device cookie", () => {
  it("round-trips the remembered logins", () => {
    const logins = [login(1), login(2)];
    assert.deepEqual(openDeviceLogins(sealDeviceLogins(logins, KEY), KEY), logins);
  });

  it("is unreadable without the key (no user id or token in the clear)", () => {
    const sealed = sealDeviceLogins([login(1)], KEY);
    assert.ok(!sealed.includes("u1") && !sealed.includes("token-1"));
    assert.ok(!Buffer.from(sealed.split(".")[3], "base64url").toString("utf8").includes("token-1"));
  });

  it("refuses a tampered cookie", () => {
    const [v, iv, tag, body] = sealDeviceLogins([login(1)], KEY).split(".");
    const bytes = Buffer.from(body, "base64url");
    bytes[0] ^= 1;
    assert.deepEqual(openDeviceLogins([v, iv, tag, bytes.toString("base64url")].join("."), KEY), []);
    assert.deepEqual(openDeviceLogins([v, iv, Buffer.alloc(16).toString("base64url"), body].join("."), KEY), []);
  });

  it("refuses a cookie sealed with another key, a forged plain list and garbage", () => {
    const sealed = sealDeviceLogins([login(1)], deviceLoginKey("other-secret"));
    assert.deepEqual(openDeviceLogins(sealed, KEY), []);
    assert.deepEqual(openDeviceLogins(JSON.stringify([login(1)]), KEY), []);
    assert.deepEqual(openDeviceLogins("d1.a.b.c", KEY), []);
    assert.deepEqual(openDeviceLogins("", KEY), []);
    assert.deepEqual(openDeviceLogins(undefined, KEY), []);
  });

  it("keeps at most the device limit and drops malformed entries", () => {
    const many = Array.from({ length: MAX_DEVICE_LOGINS + 2 }, (_, i) => login(i));
    assert.equal(openDeviceLogins(sealDeviceLogins(many, KEY), KEY).length, MAX_DEVICE_LOGINS);
    const odd = [login(1), { i: "x" }, null, "y"] as unknown as DeviceLogin[];
    assert.deepEqual(openDeviceLogins(sealDeviceLogins(odd, KEY), KEY), [login(1)]);
  });

  it("needs a secret", () => {
    assert.throws(() => deviceLoginKey(""));
  });
});

describe("remembering logins", () => {
  it("adds a second login and keeps the first", () => {
    const { logins, dropped } = withLogin([login(1)], login(2));
    assert.deepEqual(logins.map((l) => l.u), ["u1", "u2"]);
    assert.deepEqual(dropped, []);
  });

  it("replaces an earlier entry of the same user (logging in again)", () => {
    const again = { ...login(1), i: "rl1b", t: "new" };
    const { logins, dropped } = withLogin([login(1), login(2)], again);
    assert.deepEqual(logins.map((l) => l.i), ["rl2", "rl1b"]);
    assert.deepEqual(dropped.map((l) => l.i), ["rl1"]);
  });

  it("forgets the least recently used login when the device is full", () => {
    const full = [login(1, 50), login(2, 10), login(3, 40), login(4, 30), login(5, 20)];
    const { logins, dropped } = withLogin(full, login(6, 100));
    assert.equal(logins.length, MAX_DEVICE_LOGINS);
    assert.deepEqual(dropped.map((l) => l.u), ["u2"]);
    assert.ok(logins.some((l) => l.u === "u6"));
  });

  it("removes a user's login and marks one used", () => {
    assert.deepEqual(withoutUser([login(1), login(2)], "u1").map((l) => l.u), ["u2"]);
    assert.equal(touched([login(1), login(2)], "rl2", 999)[1].a, 999);
  });
});

describe("rememberedLoginProblem", () => {
  const now = Date.parse("2026-10-20T12:00:00Z");
  const l = login(1);
  const row = { userId: "u1", tokenHash: tokenHash(l.t), sessionVersion: 2, expiresAt: new Date(now + 1000) };
  const user = { status: "ACTIVE", role: "USER", sessionVersion: 2 };

  it("accepts a valid remembered login", () => {
    assert.equal(rememberedLoginProblem(l, row, user, now), null);
  });

  it("refuses a login that was logged out of or removed (row gone)", () => {
    assert.equal(rememberedLoginProblem(l, null, user, now), "unknown");
  });

  it("refuses a changed password (sessionVersion moved on)", () => {
    assert.equal(rememberedLoginProblem(l, row, { ...user, sessionVersion: 3 }, now), "password_changed");
  });

  it("refuses an expired login", () => {
    assert.equal(rememberedLoginProblem(l, { ...row, expiresAt: new Date(now) }, user, now), "expired");
  });

  it("refuses a suspended or deleted user", () => {
    assert.equal(rememberedLoginProblem(l, row, { ...user, status: "SUSPENDED" }, now), "inactive");
    assert.equal(rememberedLoginProblem(l, row, null, now), "inactive");
  });

  it("refuses a wrong token or another user's row", () => {
    assert.equal(rememberedLoginProblem({ ...l, t: "guess" }, row, user, now), "bad_token");
    assert.equal(rememberedLoginProblem({ ...l, u: "u9" }, row, user, now), "wrong_user");
  });

  it("never signs in an admin through a remembered login", () => {
    assert.equal(rememberedLoginProblem(l, row, { ...user, role: "ADMIN" }, now), "not_a_client");
  });

  it("compares tokens by hash", () => {
    assert.ok(tokenMatches("abc", tokenHash("abc")));
    assert.ok(!tokenMatches("abd", tokenHash("abc")));
    assert.ok(!tokenMatches("abc", "short"));
  });
});

describe("cookieFromHeader", () => {
  it("finds the device cookie among others", () => {
    assert.equal(cookieFromHeader(`a=1; ${DEVICE_LOGINS_COOKIE}=d1.x.y.z; b=2`, DEVICE_LOGINS_COOKIE), "d1.x.y.z");
    assert.equal(cookieFromHeader("a=1", DEVICE_LOGINS_COOKIE), null);
    assert.equal(cookieFromHeader(null, DEVICE_LOGINS_COOKIE), null);
  });
});
