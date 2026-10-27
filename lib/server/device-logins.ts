import "server-only";
import { cookies } from "next/headers";
import { CredentialsSignin } from "next-auth";
import { signIn, signOut } from "@/auth";
import { COOKIES } from "@/config/site";
import { randomToken } from "@/lib/crypto";
import { db } from "@/lib/db";
import { deviceKey, problemOf } from "@/lib/auth/remembered";
import {
  DEVICE_LOGIN_TTL_MS,
  DEVICE_LOGINS_COOKIE,
  MAX_DEVICE_LOGINS,
  openDeviceLogins,
  sealDeviceLogins,
  tokenHash,
  touched,
  withLogin,
  withoutUser,
  type DeviceLogin,
} from "@/lib/device-logins";
import { initials, toneFor } from "@/lib/utils";
import type { DeviceAccountsDto, Session } from "@/types";
import { ApiError } from "./http";
import { connectionStatusOf } from "./instagram-account";

/**
 * "Accounts on this device": one login = one Instagram account, and this browser remembers up to
 * MAX_DEVICE_LOGINS logins so the person can switch between them without typing a password again.
 *
 * Logging in or signing up remembers that login (rememberLogin). The browser holds the list in one sealed
 * httpOnly cookie (lib/device-logins.ts); the database holds a RememberedLogin row per entry with only the
 * token's hash. Switching signs in through the Auth.js "remembered" provider, whose authorize() accepts only
 * a login found in that request's own cookie and still valid (verifyDeviceLogin, lib/auth/remembered.ts) — so a
 * login that isn't remembered on this device can never be reached. A remembered login stops working when the person logs out
 * of it or removes it here (its row is deleted), when the password changes (setPassword deletes the rows; the
 * sessionVersion check covers the rest), when the user is suspended or deleted, or after DEVICE_LOGIN_TTL_MS
 * without use. Every request is still checked against the active session as before.
 */

const key = deviceKey;

export async function readDeviceLogins(): Promise<DeviceLogin[]> {
  return openDeviceLogins((await cookies()).get(DEVICE_LOGINS_COOKIE)?.value, key());
}

async function writeDeviceLogins(logins: DeviceLogin[]) {
  const store = await cookies();
  if (logins.length === 0) {
    store.delete(DEVICE_LOGINS_COOKIE);
    return;
  }
  store.set(DEVICE_LOGINS_COOKIE, sealDeviceLogins(logins, key()), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(DEVICE_LOGIN_TTL_MS / 1000),
  });
}

async function forgetRows(logins: DeviceLogin[]) {
  if (logins.length) await db.rememberedLogin.deleteMany({ where: { OR: logins.map((l) => ({ id: l.i, userId: l.u })) } });
}

/** A new remembered login for a client user (admins aren't remembered), or null. */
async function issue(userId: string): Promise<DeviceLogin | null> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { role: true, status: true, sessionVersion: true } });
  if (!user || user.role !== "USER" || user.status !== "ACTIVE") return null;
  const token = randomToken(32);
  const now = Date.now();
  const row = await db.rememberedLogin.create({
    data: { userId, tokenHash: tokenHash(token), sessionVersion: user.sessionVersion, expiresAt: new Date(now + DEVICE_LOGIN_TTL_MS) },
    select: { id: true },
  });
  return { i: row.id, u: userId, t: token, a: now };
}

/**
 * Remembers a login on this browser right after it signed in (log in, sign up, password change). Replaces an
 * earlier entry of the same user; a full device forgets its least recently used login. Never fails the login.
 */
export async function rememberLogin(userId: string): Promise<void> {
  try {
    const login = await issue(userId);
    if (!login) return;
    const { logins, dropped } = withLogin(await readDeviceLogins(), login);
    await forgetRows(dropped);
    await writeDeviceLogins(logins);
  } catch (error) {
    console.error("[device-logins] remember failed", error);
  }
}

/** Splits the device's logins into the ones that still work and the rest (whose rows are deleted). */
async function usable(logins: DeviceLogin[]) {
  const problems = await Promise.all(logins.map(problemOf));
  const invalid = logins.filter((_, i) => problems[i]);
  await forgetRows(invalid);
  return { valid: logins.filter((_, i) => !problems[i]), changed: invalid.length > 0 };
}

/**
 * The switcher's list: every login remembered here that still works (the others are forgotten), in the
 * order they were added. The signed-in login is always on it — a session from before this device
 * remembered logins gets remembered now.
 */
export async function listDeviceAccounts(session: Session): Promise<DeviceAccountsDto> {
  let { valid, changed } = await usable(await readDeviceLogins());
  if (!valid.some((l) => l.u === session.userId)) {
    const login = await issue(session.userId);
    if (login) {
      const next = withLogin(valid, login);
      await forgetRows(next.dropped);
      valid = next.logins;
      changed = true;
    }
  }
  if (changed) await writeDeviceLogins(valid);

  const users = await db.user.findMany({
    where: { id: { in: valid.map((l) => l.u) } },
    select: {
      id: true,
      business: {
        select: {
          id: true,
          name: true,
          instagramHandle: true,
          avatarUrl: true,
          onboardingStatus: true,
          instagramConnection: { select: { status: true, tokenExpiresAt: true } },
        },
      },
    },
  });
  const byId = new Map(users.map((u) => [u.id, u.business]));
  return {
    items: valid.flatMap((l) => {
      const b = byId.get(l.u);
      if (!b) return [];
      return [
        {
          id: l.i,
          handle: b.instagramHandle,
          name: b.name,
          avatarUrl: b.avatarUrl,
          avatarInitials: initials(b.name || b.instagramHandle || "IG"),
          avatarTone: toneFor(b.instagramHandle ?? b.id),
          connection: connectionStatusOf(b.instagramConnection),
          setupInProgress: b.onboardingStatus === "IN_PROGRESS",
          active: l.u === session.userId,
        },
      ];
    }),
    max: MAX_DEVICE_LOGINS,
    canAdd: valid.length < MAX_DEVICE_LOGINS,
  };
}

/** Signs in as a remembered login (the provider checks it again) and marks it used. False when it no longer works. */
async function signInAs(logins: DeviceLogin[], login: DeviceLogin): Promise<boolean> {
  try {
    await signIn("remembered", { loginId: login.i, redirect: false });
  } catch (error) {
    if (error instanceof CredentialsSignin) return false;
    throw error;
  }
  const now = Date.now();
  await db.rememberedLogin.update({ where: { id: login.i }, data: { lastUsedAt: new Date(now), expiresAt: new Date(now + DEVICE_LOGIN_TTL_MS) } });
  await writeDeviceLogins(touched(logins, login.i, now));
  return true;
}

/**
 * Switches this browser's session to another login remembered here. Not on this device → 404; stopped
 * working (password changed, logged out, suspended, expired) → it's forgotten and 409 `login_expired`.
 * Answers where the browser goes next (a full page load, so nothing of the old account stays on screen).
 */
export async function switchDeviceLogin(session: Session, loginId: string): Promise<{ to: string }> {
  const logins = await readDeviceLogins();
  const login = logins.find((l) => l.i === loginId);
  if (!login) throw new ApiError(404, "not_found", "This account isn't remembered on this device.");
  if (login.u === session.userId) return { to: "/gallery" };
  if ((await problemOf(login)) || !(await signInAs(logins, login))) {
    await forgetRows([login]);
    await writeDeviceLogins(logins.filter((l) => l !== login));
    throw new ApiError(409, "login_expired", "This account needs its password again.");
  }
  return { to: "/gallery?switched=1" };
}

/** Removes another login from this device (the signed-in one is logged out of instead → 409 `login_active`). */
export async function forgetDeviceLogin(session: Session, loginId: string): Promise<void> {
  const logins = await readDeviceLogins();
  const login = logins.find((l) => l.i === loginId);
  if (!login) throw new ApiError(404, "not_found", "This account isn't remembered on this device.");
  if (login.u === session.userId) throw new ApiError(409, "login_active", "Log out of this account instead.");
  await forgetRows([login]);
  await writeDeviceLogins(logins.filter((l) => l !== login));
}

/**
 * "Log out of @handle": forgets the signed-in login on this device and switches to the most recently used
 * other login that still works; with none left, signs out. `all` ("Log out of all accounts"): forgets every
 * login here and signs out. Answers where the browser goes next (a full page load).
 */
export async function logOutOfDevice(session: Session | null, all: boolean): Promise<{ to: string }> {
  const logins = await readDeviceLogins();
  (await cookies()).delete(COOKIES.preview);
  if (all || !session) {
    await forgetRows(logins);
    await writeDeviceLogins([]);
  } else {
    await forgetRows(logins.filter((l) => l.u === session.userId));
    const { valid } = await usable(withoutUser(logins, session.userId));
    for (const next of [...valid].sort((a, b) => b.a - a.a)) {
      if (await signInAs(valid, next)) return { to: "/gallery?switched=1" };
    }
    await writeDeviceLogins([]);
  }
  await signOut({ redirect: false });
  return { to: "/login" };
}

/** Forgets `userId`'s login on this device (a plain log out). */
export async function forgetLoginOnDevice(userId: string): Promise<void> {
  const logins = await readDeviceLogins();
  await forgetRows(logins.filter((l) => l.u === userId));
  await writeDeviceLogins(withoutUser(logins, userId));
}

/** Whether this browser remembers a login other than `userId` (the set-up screens then show the switcher). */
export async function hasOtherDeviceLogins(userId: string): Promise<boolean> {
  return (await readDeviceLogins()).some((l) => l.u !== userId);
}
