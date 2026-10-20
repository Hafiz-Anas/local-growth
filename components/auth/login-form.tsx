"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Info, Loader2, X } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Avatar } from "@/components/shared/avatar";
import { Button } from "@/components/ui/button";
import type { DemoAccount } from "@/config/demo";
import { loginAction, type LoginError, type LoginState } from "@/lib/auth/actions";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { AppShowcase } from "./app-showcase";
import { AuthFooter, FloatingInput, ShowPasswordToggle } from "./auth-parts";

const initialState: LoginState = { error: null, email: "" };

const ERROR_MESSAGES: Record<LoginError, string> = {
  missing_fields: "auth.missing",
  invalid_credentials: "auth.invalid",
  suspended: "auth.suspended",
  rate_limited: "auth.rateLimited",
};

/**
 * Login screen following Instagram's web login layout (showcase + narrow
 * bordered card), with our own logo and name throughout — never Instagram's or Meta's marks.
 * Email and password only: Instagram is connected later, in onboarding.
 * `adding`: "Add account" from the switcher — the signed-in login stays remembered on this device.
 */
export function LoginForm({ demoAccounts, sessionExpired = false, adding = false }: { demoAccounts: DemoAccount[]; sessionExpired?: boolean; adding?: boolean }) {
  const { t } = useI18n();
  const [state, formAction, pending] = useActionState(loginAction, initialState);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showDemo, setShowDemo] = useState(true);

  const canSubmit = email.trim().length > 0 && password.length > 0 && !pending;
  // Wrong-password style errors mark the fields; account-level ones don't.
  const fieldsInvalid = state.error === "invalid_credentials" || state.error === "missing_fields";

  return (
    <div className="flex min-h-dvh flex-col">
      <main className="flex flex-1 items-center justify-center px-4 py-8 sm:py-12">
        <div className="flex w-full max-w-[935px] items-center justify-center gap-8 lg:gap-16">
          <div className="hidden shrink-0 md:block">
            <AppShowcase />
          </div>

          <div className="w-full max-w-[350px]">
            <div className="border-border px-4 pt-8 pb-6 sm:rounded-[1px] sm:border sm:px-10 sm:pt-10">
              <div className="mb-8 flex justify-center">
                <Logo className="[&_svg]:size-9 [&>span]:text-[30px]" />
              </div>

              {adding && <AddingNotice hint={t("deviceAccounts.addingLoginHint")} />}

              {sessionExpired && !state.error && (
                <p role="status" className="mb-4 rounded-card bg-secondary-bg px-3 py-2.5 text-center text-caption text-muted">
                  {t("auth.sessionExpired")}
                </p>
              )}

              <form action={formAction} className="space-y-1.5">
                <FloatingInput
                  name="email"
                  type="email"
                  autoComplete="username"
                  label={t("auth.email")}
                  value={email}
                  onChange={setEmail}
                  invalid={fieldsInvalid}
                />
                <FloatingInput
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  label={t("auth.password")}
                  value={password}
                  onChange={setPassword}
                  invalid={fieldsInvalid}
                  trailing={password && <ShowPasswordToggle shown={showPassword} onToggle={() => setShowPassword((v) => !v)} />}
                />
                <Button type="submit" className="mt-3 w-full" disabled={!canSubmit} aria-busy={pending}>
                  {pending ? <Loader2 className="size-4 animate-spin" aria-label={t("auth.loggingIn")} /> : t("auth.login")}
                </Button>
              </form>

              {state.error && (
                <p role="alert" className="mt-5 text-center text-body text-danger">
                  {t(ERROR_MESSAGES[state.error])}
                </p>
              )}

              <Link href="/forgot-password" className="mx-auto mt-5 block w-fit text-body text-link hover:underline">
                {t("auth.forgot")}
              </Link>
            </div>

            <div className="mt-2.5 border-border py-5 text-center text-body sm:rounded-[1px] sm:border">
              {t("auth.noAccount")}{" "}
              <Link href={adding ? "/signup?add=1" : "/signup"} className="font-semibold text-primary hover:text-link">
                {t("auth.signUp")}
              </Link>
            </div>

            {showDemo && demoAccounts.length > 0 && (
              <DemoAccounts
                accounts={demoAccounts}
                onPick={(a) => {
                  setEmail(a.email);
                  setPassword(a.password);
                }}
                onDismiss={() => setShowDemo(false)}
              />
            )}
          </div>
        </div>
      </main>

      <AuthFooter />
    </div>
  );
}

/** "Add account" mode: what's happening, and a way back to the signed-in account (a full page load). */
export function AddingNotice({ hint }: { hint: string }) {
  const { t } = useI18n();
  return (
    <div className="mb-5 rounded-card bg-secondary-bg px-3 py-2.5 text-center" data-testid="adding-account">
      <p className="text-body font-semibold">{t("deviceAccounts.addTitle")}</p>
      <p className="mt-0.5 text-caption text-muted">{hint}</p>
      <a href="/dashboard" className="mt-1.5 inline-block text-caption font-semibold text-primary hover:text-link" data-testid="adding-cancel">
        {t("deviceAccounts.cancel")}
      </a>
    </div>
  );
}

function DemoAccounts({
  accounts,
  onPick,
  onDismiss,
}: {
  accounts: DemoAccount[];
  onPick: (account: DemoAccount) => void;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="mt-2.5 rounded-card border border-border bg-secondary-bg p-3">
      <div className="flex items-start gap-2">
        <Info className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-caption font-semibold">{t("auth.demoTitle")}</p>
          <p className="text-caption text-muted">{t("auth.demoHint")}</p>
        </div>
        <button type="button" onClick={onDismiss} className="rounded-pill p-0.5 text-muted hover:bg-hover hover:text-foreground" aria-label={t("common.dismiss")}>
          <X className="size-4" />
        </button>
      </div>
      <ul className="mt-2 space-y-0.5">
        {accounts.map((account) => (
          <li key={account.email}>
            <button
              type="button"
              onClick={() => onPick(account)}
              className="flex w-full items-center gap-2 rounded-button px-1.5 py-1.5 text-start hover:bg-hover"
            >
              <Avatar src={account.avatarUrl} initials={account.name.slice(0, 2).toUpperCase()} tone="night" size="xs" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-caption font-semibold">
                  {account.name}
                  <span className={cn("ms-1.5 font-normal", account.role === "admin" ? "text-ig-pink" : "text-muted")}>
                    · {account.role === "admin" ? t("auth.roleAdmin") : t("auth.roleUser")}
                  </span>
                </span>
                <span className="block truncate text-[11px] text-muted">
                  <bdi>{account.email}</bdi>
                </span>
              </span>
              <span className="shrink-0 font-mono text-[11px] text-muted" dir="ltr">
                {account.password}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
