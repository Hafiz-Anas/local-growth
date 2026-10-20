import "server-only";
import { db } from "@/lib/db";
import { DEVICE_LOGINS_COOKIE, cookieFromHeader, deviceLoginKey, openDeviceLogins, rememberedLoginProblem, type DeviceLogin, type RememberedProblem } from "@/lib/device-logins";

/**
 * The checks behind the Auth.js "remembered" provider (auth.ts), apart from lib/server/device-logins.ts so
 * auth.ts doesn't import a module that imports it.
 */

export const deviceKey = () => deviceLoginKey(process.env.AUTH_SECRET ?? "");

/** Why a remembered login may not be used (lib/device-logins.ts), or null when it may. */
export async function problemOf(login: DeviceLogin): Promise<RememberedProblem | null> {
  const row = await db.rememberedLogin.findUnique({
    where: { id: login.i },
    select: { userId: true, tokenHash: true, sessionVersion: true, expiresAt: true, user: { select: { status: true, role: true, sessionVersion: true } } },
  });
  return rememberedLoginProblem(login, row, row?.user ?? null, Date.now());
}

/**
 * The user of `loginId` when that login is in the request's own device cookie and still valid; otherwise
 * null. A login id alone is worthless: the sealed cookie with its token must come with it.
 */
export async function verifyDeviceLogin(cookieHeader: string | null, loginId: string): Promise<string | null> {
  const login = openDeviceLogins(cookieFromHeader(cookieHeader, DEVICE_LOGINS_COOKIE), deviceKey()).find((l) => l.i === loginId);
  if (!login || (await problemOf(login))) return null;
  return login.u;
}
