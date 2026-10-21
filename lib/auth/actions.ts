"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthError, CredentialsSignin } from "next-auth";
import { signIn, signOut } from "@/auth";
import { HOME_BY_ROLE } from "@/config/navigation";
import { COOKIES } from "@/config/site";
import { db } from "@/lib/db";
import { forgetLoginOnDevice, rememberLogin } from "@/lib/server/device-logins";
import { getLocale } from "@/lib/i18n/server";
import { normalizeTheme } from "@/lib/theme-script";
import { SIGNUP_LIMIT, clientIp, getRateLimiter } from "@/lib/server/rate-limit";
import { startInstagramSignup } from "@/lib/server/signup";
import { getSession, requireAdmin } from "./server";

export type LoginError = "invalid_credentials" | "missing_fields" | "suspended" | "rate_limited";

export interface LoginState {
  error: LoginError | null;
  email: string;
}

const KNOWN_CODES: LoginError[] = ["invalid_credentials", "suspended", "rate_limited"];

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "missing_fields", email };

  (await cookies()).delete(COOKIES.preview);
  try {
    await signIn("credentials", { email, password, redirect: false });
  } catch (error) {
    if (error instanceof AuthError) {
      const code = error instanceof CredentialsSignin ? (error.code as LoginError) : null;
      return { error: code && KNOWN_CODES.includes(code) ? code : "invalid_credentials", email };
    }
    throw error;
  }
  const user = await db.user.findUnique({ where: { email: email.toLowerCase() }, select: { id: true, role: true, uiPreferences: true } });
  // This browser remembers the login, so the person can switch back to it later without the password.
  if (user) await rememberLogin(user.id);
  // The saved language and theme apply from the first page (no flash); the sidebar is applied in the browser.
  const prefs = user?.uiPreferences as { language?: unknown; theme?: unknown } | null;
  const store = await cookies();
  if (prefs?.language === "en" || prefs?.language === "ar") {
    store.set(COOKIES.locale, prefs.language, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  }
  store.set(COOKIES.theme, normalizeTheme(prefs?.theme), { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  // Straight to the role's home page (redirecting via "/" left the address bar on "/").
  redirect(HOME_BY_ROLE[user?.role === "ADMIN" ? "admin" : "user"]);
}

export type SignupField = "email" | "password";
export type SignupError = "invalid" | "email_taken" | "rate_limited" | "unavailable" | "generic";

export interface SignupState {
  error: SignupError | null;
  /** Fields the server rejected (the form also checks them before submitting). */
  fields: SignupField[];
  values: { email: string };
}

/**
 * Public sign-up (one page): checks email and password as always, then sends the browser to connect
 * Instagram. No account exists until Instagram is connected — see lib/server/signup.ts. Rate-limited per IP.
 */
export async function signupAction(_prev: SignupState, formData: FormData): Promise<SignupState> {
  const raw = {
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  };
  const values = { email: raw.email };

  if (!(await getRateLimiter().consume(SIGNUP_LIMIT, clientIp(await headers())))) return { error: "rate_limited", fields: [], values };

  let started: Awaited<ReturnType<typeof startInstagramSignup>>;
  try {
    started = await startInstagramSignup({ ...raw, language: await getLocale() });
  } catch (error) {
    console.error("[signup] failed", error);
    return { error: "generic", fields: [], values };
  }
  if (!started.ok) return { error: started.error, fields: started.fields, values };
  redirect(started.redirectTo);
}

/**
 * Plain log out to /login (admins). A client login is also forgotten on this device; client screens use
 * `logOutOf()` (lib/api/device-accounts.ts) instead, which moves on to another login remembered here.
 */
export async function logoutAction() {
  (await cookies()).delete(COOKIES.preview);
  const session = await getSession();
  if (session?.role === "user") await forgetLoginOnDevice(session.userId);
  await signOut({ redirectTo: "/login" });
}

const PREVIEW_MAX_AGE = 60 * 60 * 4;

/** Admin only: view the user-facing app exactly as a given business sees it. */
export async function startPreviewAction(clientId: string) {
  await requireAdmin();
  const business = await db.business.findUnique({ where: { id: clientId }, select: { id: true } });
  if (!business) redirect("/admin/clients");
  (await cookies()).set(COOKIES.preview, business.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: PREVIEW_MAX_AGE,
  });
  redirect("/dashboard");
}

export async function exitPreviewAction() {
  await requireAdmin();
  const store = await cookies();
  const clientId = store.get(COOKIES.preview)?.value;
  store.delete(COOKIES.preview);
  redirect(clientId ? `/admin/clients/${clientId}` : "/admin");
}
