"use client";

import { startTransition, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { AtSign, Camera, HelpCircle, Loader2, LogOut } from "lucide-react";
import { HANDLE_PATTERN, normalizeHandle } from "@/components/competitors/helpers";
import { MetaAccountPicker, MetaConnectButton, MetaOutcomeNotice, useMetaOutcome } from "@/components/instagram/meta-connect";
import { LogoMark, Wordmark } from "@/components/brand/logo";
import { AccountSwitcher, type CurrentAccount } from "@/components/layout/account-switcher";
import { LanguageToggle, ThemeToggle } from "@/components/layout/toggles";
import { VerifyEmailBanner } from "@/components/shared/verify-email-banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { reportOnboardingEvent } from "@/lib/api/brand";
import { apiFetch, type ApiClientError } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { logoutAction } from "@/lib/auth/actions";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { notify } from "@/store/ui-store";
import type { ConnectFlow, InstagramConnectionDto } from "@/types";

/**
 * Sign-up, step 2 of 2: connect Instagram. With INSTAGRAM_PROVIDER=meta this is Facebook Login for
 * Business (back here with ?instagram=<outcome>); otherwise the mock connects a typed handle at once.
 * Required: the business is named after the account, and the wizard reads its posts. Once connected
 * the server page sends the user on to the wizard.
 */
export function ConnectInstagram({
  flow,
  connection,
  account,
  addedAccount,
  email,
  emailUnverified,
  verificationUnsent,
  userName,
}: {
  flow: ConnectFlow;
  connection: InstagramConnectionDto;
  account?: CurrentAccount;
  /** "Add account": connecting the new account rather than signing up. */
  addedAccount: boolean;
  email: string;
  emailUnverified: boolean;
  verificationUnsent: boolean;
  userName: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const { outcome, clear } = useMetaOutcome();
  const done = () => {
    router.replace("/onboarding");
    router.refresh();
  };

  useEffect(() => reportOnboardingEvent("instagram", "started"), []);

  const logout = () => startTransition(() => logoutAction());

  return (
    <div className="flex min-h-dvh flex-col">
      <VerifyEmailBanner unverified={emailUnverified} email={email} sendFailed={verificationUnsent} />
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 w-full max-w-[680px] items-center gap-2 px-4">
          {account ? (
            <AccountSwitcher current={account} compact />
          ) : (
            <span className="inline-flex items-center gap-2">
              <LogoMark className="size-7" />
              <Wordmark className="hidden text-[18px] sm:inline" />
            </span>
          )}
          <span className="ms-auto" />
          <ThemeToggle />
          <LanguageToggle compact />
          <Button variant="ghost" size="sm" onClick={logout} title={t("onboarding.logoutHint", { name: userName })}>
            <LogOut className="size-4 rtl:-scale-x-100" />
            <span className="hidden sm:inline">{t("topbar.logout")}</span>
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[480px] flex-1 px-4 pt-8 pb-12 sm:pt-12">
        {!addedAccount && (
          <p className="mb-2 text-caption text-muted" data-testid="signup-step">
            {t("signup.stepOf", { n: 2, total: 2 })} · {t("signup.steps.instagram")}
          </p>
        )}
        <h1 className="text-heading font-bold">{t(addedAccount ? "signup.connect.titleAdded" : "signup.connect.title")}</h1>
        <p className="mt-1.5 text-body text-muted">{t("signup.connect.helper")}</p>

        {outcome && outcome !== "connected" && outcome !== "pick" && <MetaOutcomeNotice outcome={outcome} returnTo="signup" onDismiss={clear} className="mt-6" />}

        <div className="mt-6">
          {connection.status !== "disconnected" ? (
            // Connected meanwhile (another tab): the server page sends them on.
            <Button size="lg" className="w-full" onClick={done}>
              {t("onboarding.continue")}
            </Button>
          ) : flow === "mock" ? (
            <MockConnectForm onConnected={done} />
          ) : (
            <div className="rounded-panel border border-border p-5">
              <div className="mb-4 flex items-center gap-3">
                <span className="flex size-12 shrink-0 items-center justify-center rounded-pill border-2 border-foreground">
                  <Camera className="size-6" strokeWidth={1.5} aria-hidden="true" />
                </span>
                <p className="text-body">{t("onboarding.instagram.metaWhy")}</p>
              </div>
              {flow === "meta" ? (
                <>
                  <MetaConnectButton returnTo="signup" size="lg" className="w-full" />
                  <p className="mt-3 text-caption text-muted">{t("instagramConnect.connectHint")}</p>
                  <ConnectHelp open={outcome === "no_account" || outcome === "declined"} />
                </>
              ) : (
                <p role="status" className="text-caption text-warning">
                  {t("instagramConnect.unavailable")}
                </p>
              )}
            </div>
          )}
        </div>
        <p className="mt-4 text-caption text-muted">{t("signup.connect.why")}</p>
      </main>

      <MetaAccountPicker
        open={outcome === "pick"}
        onClose={clear}
        onConnected={(result) => {
          clear();
          if (result.outcome === "connected") {
            notify.success(result.username ? t("instagramConnect.outcomes.connectedAs", { username: result.username }) : t("instagramConnect.outcomes.connected"));
            done();
          } else notify.error(t(`instagramConnect.outcomes.${result.outcome}`));
        }}
      />
    </div>
  );
}

/** Mock flow (INSTAGRAM_PROVIDER=mock): type the handle, connect at once. */
function MockConnectForm({ onConnected }: { onConnected: () => void }) {
  const { t } = useI18n();
  const [handle, setHandle] = useState("");
  const [error, setError] = useState<string | null>(null);

  const connect = useMutation<InstagramConnectionDto, ApiClientError, string>({
    meta: { handlesErrors: true },
    mutationFn: (value) => apiFetch("/api/instagram/connection", { method: "POST", body: { handle: value } }),
    onSuccess: () => {
      setError(null);
      onConnected();
    },
    onError: (e) => {
      const reason = Array.isArray(e.details) ? (e.details as Array<{ message?: string }>)[0]?.message : undefined;
      setError(reason === "handle_taken" ? t("onboarding.instagram.handleTaken") : reason === "already_added" ? t("onboarding.instagram.alreadyAdded") : errorMessage(e, t));
    },
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const value = normalizeHandle(handle);
    if (!HANDLE_PATTERN.test(value)) return setError(t("competitors.invalidHandle"));
    connect.mutate(value);
  }

  return (
    <form onSubmit={submit} className="rounded-panel border border-border p-5">
      <div className="mb-4 flex items-center gap-3">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-pill border-2 border-foreground">
          <Camera className="size-6" strokeWidth={1.5} aria-hidden="true" />
        </span>
        <p className="text-body">{t("onboarding.instagram.why")}</p>
      </div>
      <label htmlFor="ob-handle" className="mb-1.5 block text-body font-semibold">
        {t("onboarding.instagram.handle")}
      </label>
      <div className="relative">
        <AtSign className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
        <Input
          id="ob-handle"
          value={handle}
          onChange={(e) => {
            setHandle(e.target.value);
            setError(null);
          }}
          placeholder="yourbusiness.kw"
          dir="ltr"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={Boolean(error) || undefined}
          className={cn("ps-9", error && "border-danger")}
        />
      </div>
      {error && (
        <p role="alert" className="mt-2 text-caption text-danger">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" className="mt-3 w-full" disabled={!handle.trim() || connect.isPending}>
        {connect.isPending ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
        {connect.isPending ? t("settings.instagram.connecting") : t("onboarding.instagram.connect")}
      </Button>
      <p className="mt-3 text-caption text-muted">{t("onboarding.instagram.mockNote")}</p>
    </form>
  );
}

/**
 * Why a connection can fail and how to fix it: Instagram only shares data for professional
 * (Business or Creator) accounts linked to a Facebook Page. Opens by itself after Facebook
 * reported no usable account.
 */
function ConnectHelp({ open }: { open: boolean }) {
  const { t } = useI18n();
  return (
    <details open={open} className="mt-4 rounded-card bg-hover px-3 py-2 text-caption" data-testid="connect-help">
      <summary className="flex cursor-pointer items-center gap-1.5 font-semibold">
        <HelpCircle className="size-4 shrink-0" aria-hidden="true" />
        {t("onboarding.instagram.help.title")}
      </summary>
      <ol className="mt-2 list-decimal space-y-1.5 ps-5">
        <li>{t("onboarding.instagram.help.professional")}</li>
        <li>{t("onboarding.instagram.help.page")}</li>
        <li>{t("onboarding.instagram.help.login")}</li>
      </ol>
    </details>
  );
}
