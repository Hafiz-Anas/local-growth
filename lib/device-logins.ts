import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Logins remembered on this device ("Accounts on this device") — the pure rules, tested in
 * tests/device-logins.test.ts. The browser keeps a list of { login id, user id, secret token } in one
 * httpOnly cookie, sealed with AES-256-GCM under a key only the server has, so the page can neither
 * read nor change it; the database keeps only the token's SHA-256 (RememberedLogin). The server code is
 * lib/server/device-logins.ts.
 */

export const DEVICE_LOGINS_COOKIE = "lge_device_logins";
/** Logins one browser remembers. */
export const MAX_DEVICE_LOGINS = 5;
/** A remembered login lasts this long after it was last used. */
export const DEVICE_LOGIN_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export interface DeviceLogin {
  /** RememberedLogin id. */
  i: string;
  /** User id. */
  u: string;
  /** Secret token (only its hash is stored). */
  t: string;
  /** Added or last switched to (ms), for evicting the least recently used. */
  a: number;
}

const VERSION = "d1";

/** The sealing key, derived from the app's secret (AUTH_SECRET). */
export function deviceLoginKey(secret: string): Buffer {
  if (!secret) throw new Error("AUTH_SECRET is not set.");
  return createHash("sha256").update(`lge-device-logins:${secret}`).digest();
}

export function sealDeviceLogins(logins: DeviceLogin[], key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(logins), "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

const isLogin = (v: unknown): v is DeviceLogin => {
  const l = v as DeviceLogin;
  return Boolean(l) && typeof l.i === "string" && typeof l.u === "string" && typeof l.t === "string" && typeof l.a === "number" && l.i.length <= 64 && l.u.length <= 64 && l.t.length <= 128;
};

/** The remembered logins in a cookie value; an empty list for anything missing, tampered with or sealed under another key. */
export function openDeviceLogins(value: string | null | undefined, key: Buffer): DeviceLogin[] {
  if (!value) return [];
  const [version, iv, tag, ciphertext] = value.split(".");
  if (version !== VERSION || !iv || !tag || !ciphertext) return [];
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const parsed: unknown = JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isLogin).slice(0, MAX_DEVICE_LOGINS);
  } catch {
    return [];
  }
}

/**
 * Remembers `login`: it replaces any earlier login of the same user, and when the device is full the least
 * recently used other login makes room. `dropped` are the logins no longer remembered (revoke them).
 */
export function withLogin(logins: DeviceLogin[], login: DeviceLogin, max = MAX_DEVICE_LOGINS): { logins: DeviceLogin[]; dropped: DeviceLogin[] } {
  const dropped = logins.filter((l) => l.u === login.u);
  let kept = logins.filter((l) => l.u !== login.u);
  while (kept.length >= max) {
    const oldest = kept.reduce((a, b) => (b.a < a.a ? b : a));
    dropped.push(oldest);
    kept = kept.filter((l) => l !== oldest);
  }
  return { logins: [...kept, login], dropped };
}

export function withoutUser(logins: DeviceLogin[], userId: string): DeviceLogin[] {
  return logins.filter((l) => l.u !== userId);
}

export function touched(logins: DeviceLogin[], id: string, now: number): DeviceLogin[] {
  return logins.map((l) => (l.i === id ? { ...l, a: now } : l));
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Constant-time check of a token against the stored hash. */
export function tokenMatches(token: string, hash: string): boolean {
  const a = Buffer.from(tokenHash(token), "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export type RememberedProblem = "unknown" | "wrong_user" | "bad_token" | "expired" | "inactive" | "password_changed" | "not_a_client";

/**
 * Why a remembered login may NOT be used, or null when it may. `row` is the RememberedLogin found by
 * the cookie's id (null when revoked: logged out or removed from the device), `user` its user (null
 * when deleted).
 */
export function rememberedLoginProblem(
  login: DeviceLogin,
  row: { userId: string; tokenHash: string; sessionVersion: number; expiresAt: Date } | null,
  user: { status: string; role: string; sessionVersion: number } | null,
  now: number,
): RememberedProblem | null {
  if (!row) return "unknown";
  if (row.userId !== login.u) return "wrong_user";
  if (!tokenMatches(login.t, row.tokenHash)) return "bad_token";
  if (row.expiresAt.getTime() <= now) return "expired";
  if (!user || user.status !== "ACTIVE") return "inactive";
  if (user.sessionVersion !== row.sessionVersion) return "password_changed";
  if (user.role !== "USER") return "not_a_client";
  return null;
}

/** Reads one cookie from a raw Cookie header. */
export function cookieFromHeader(header: string | null | undefined, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}
