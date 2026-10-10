"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthError, CredentialsSignin } from "next-auth";
import { signIn, signOut } from "@/auth";
import { HOME_BY_ROLE } from "@/config/navigation";
import { COOKIES } from "@/config/site";
import { db } from "@/lib/db";
import { getLocale } from "@/lib/i18n/server";
import { SIGNUP_LIMIT, clientIp, getRateLimiter } from "@/lib/server/rate-limit";
import { EmailTakenError, createSelfSignup } from "@/lib/server/signup";
import { recordError } from "@/lib/server/onboarding";
import { signupSchema } from "@/lib/validation/api";
import { passwordProblems } from "@/lib/validation/password";
import { requireAdmin } from "./server";

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
  const user = await db.user.findUnique({ where: { email: email.toLowerCase() }, select: { role: true, uiPreferences: true } });
  // The saved language applies from the first page; theme and sidebar are applied in the browser.
  const language = (user?.uiPreferences as { language?: unknown } | null)?.language;
  if (language === "en" || language === "ar") {
    (await cookies()).set(COOKIES.locale, language, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  }
  // Straight to the role's home page (redirecting via "/" left the address bar on "/").
  redirect(HOME_BY_ROLE[user?.role === "ADMIN" ? "admin" : "user"]);
}

export type SignupField = "name" | "email" | "password" | "businessName";
export type SignupError = "invalid" | "email_taken" | "rate_limited" | "generic";

export interface SignupState {
  error: SignupError | null;
  /** Fields the server rejected (the form also checks them before submitting). */
  fields: SignupField[];
  values: { name: string; email: string; businessName: string };
}

/**
 * Public sign-up: creates the user and business (see createSelfSignup), signs
 * them in and goes straight to the onboarding wizard. Rate-limited per IP.
 */
export async function signupAction(_prev: SignupState, formData: FormData): Promise<SignupState> {
  const raw = {
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
    businessName: String(formData.get("businessName") ?? ""),
  };
  const values = { name: raw.name, email: raw.email, businessName: raw.businessName };

  const requestHeaders = await headers();
  if (!(await getRateLimiter().consume(SIGNUP_LIMIT, clientIp(requestHeaders)))) return { error: "rate_limited", fields: [], values };

  const parsed = signupSchema.safeParse(raw);
  const weak = passwordProblems(raw.password, { email: raw.email, name: raw.name }).length > 0;
  if (!parsed.success || weak) {
    const fields = new Set<SignupField>(parsed.success ? [] : parsed.error.issues.map((i) => i.path[0] as SignupField));
    if (weak) fields.add("password");
    return { error: "invalid", fields: [...fields], values };
  }

  const origin = process.env.AUTH_URL ?? `${requestHeaders.get("x-forwarded-proto") ?? "http"}://${requestHeaders.get("host")}`;
  let businessId: string;
  try {
    ({ businessId } = await createSelfSignup({ ...parsed.data, language: await getLocale() }, origin));
  } catch (error) {
    if (error instanceof EmailTakenError) return { error: "email_taken", fields: ["email"], values };
    console.error("[signup] failed", error);
    return { error: "generic", fields: [], values };
  }

  (await cookies()).delete(COOKIES.preview);
  try {
    await signIn("credentials", { email: parsed.data.email, password: parsed.data.password, redirect: false });
  } catch (error) {
    // The account exists; if signing in fails (e.g. login rate limit), send them to log in.
    await recordError(businessId, "signup", { reason: "auto_login_failed" });
    if (error instanceof AuthError) redirect("/login");
    throw error;
  }
  redirect("/onboarding");
}

export async function logoutAction() {
  (await cookies()).delete(COOKIES.preview);
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
