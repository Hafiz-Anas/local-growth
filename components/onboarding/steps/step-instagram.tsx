"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AtSign, Camera, CircleCheck, HelpCircle, Loader2 } from "lucide-react";
import { ConnectedNotice, MetaAccountPicker, MetaConnectButton, MetaOutcomeNotice, MissingPermissionsNotice, useMetaOutcome } from "@/components/instagram/meta-connect";
import { Avatar } from "@/components/shared/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HANDLE_PATTERN, normalizeHandle } from "@/components/competitors/helpers";
import { apiFetch, type ApiClientError } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/queries";
import { useI18n } from "@/lib/i18n/provider";
import { cn, initials, toneFor } from "@/lib/utils";
import { notify } from "@/store/ui-store";
import type { InstagramConnectionDto } from "@/types";
import { StepFrame } from "../step-frame";
import { useWizard } from "../wizard-context";

/**
 * Step 1 — Connect Instagram (first, so later steps can use the account).
 * With INSTAGRAM_PROVIDER=meta this is Facebook Login for Business; otherwise
 * the mock connects a typed handle at once.
 * Recommended; can be skipped (and done later from Settings) unless an admin
 * made it required (System → "Require Instagram connection").
 */
export function StepInstagram() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { state, go, moving } = useWizard();
  const { outcome, username: connectedAs, clear } = useMetaOutcome();
  const ig = state.instagram;
  const connected = ig.status !== "disconnected";
  const required = ig.required;
  const username = ig.username ?? ig.handle ?? "";

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: qk.onboarding });
    queryClient.invalidateQueries({ queryKey: qk.instagramMedia });
  };

  return (
    <StepFrame
      step="instagram"
      title={t("onboarding.steps.instagram.title")}
      helper={required ? t("onboarding.instagram.requiredHelper") : t("onboarding.steps.instagram.helper")}
      primary={{ label: t("onboarding.continue"), onClick: () => go("brand", "forward"), disabled: !connected, busy: moving }}
      secondary={
        !connected &&
        !required && (
          <Button variant="ghost" size="md" onClick={() => go("brand", "forward", { skipped: true })} disabled={moving}>
            {t("onboarding.instagram.skip")}
          </Button>
        )
      }
      blockedNote={required ? t("onboarding.instagram.required") : t("onboarding.instagram.blocked")}
      reportContext={{ connected, handle: ig.handle, flow: ig.flow, provider: ig.provider, outcome }}
    >
      {outcome === "connected" && (
        <div className="mb-4">
          <ConnectedNotice username={connectedAs} onDismiss={clear} />
        </div>
      )}
      {outcome && outcome !== "connected" && outcome !== "pick" && <MetaOutcomeNotice outcome={outcome} returnTo="onboarding" onDismiss={clear} className="mb-4" />}

      {connected ? (
        <>
          <div className="flex items-center gap-3 rounded-panel border border-border p-4">
            <Avatar initials={initials(username)} tone={toneFor(username)} size="md" ring="story" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-body font-semibold" dir="ltr">
                @{username}
              </p>
              <p className="flex items-center gap-1 text-caption text-success">
                <CircleCheck className="size-3.5" aria-hidden="true" />
                {t("onboarding.instagram.connected")}
              </p>
            </div>
            {ig.needsReconnect && ig.flow === "meta" && <MetaConnectButton returnTo="onboarding" size="sm" label={t("instagramConnect.reconnect")} />}
          </div>
          {ig.provider === "meta" && !ig.needsReconnect && <MissingPermissionsNotice permissions={ig.missingPermissions} returnTo="onboarding" className="mt-3" />}
        </>
      ) : ig.flow === "mock" ? (
        <MockConnectForm initialHandle={ig.handle ?? ""} onConnected={refresh} />
      ) : (
        <div className="rounded-panel border border-border p-5">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-pill border-2 border-foreground">
              <Camera className="size-6" strokeWidth={1.5} aria-hidden="true" />
            </span>
            <p className="text-body">{t("onboarding.instagram.metaWhy")}</p>
          </div>
          {ig.flow === "meta" ? (
            <>
              <MetaConnectButton returnTo="onboarding" size="lg" className="w-full sm:w-auto" />
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
      <p className="mt-4 text-caption text-muted">{required ? t("onboarding.instagram.required") : t("onboarding.instagram.later")}</p>

      <MetaAccountPicker
        open={outcome === "pick"}
        onClose={clear}
        onConnected={(result) => {
          clear();
          refresh();
          if (result.outcome === "connected") notify.success(result.username ? t("instagramConnect.outcomes.connectedAs", { username: result.username }) : t("instagramConnect.outcomes.connected"));
          else notify.error(t(`instagramConnect.outcomes.${result.outcome}`));
        }}
      />
    </StepFrame>
  );
}

/** Mock flow (INSTAGRAM_PROVIDER=mock): type the handle, connect at once. */
function MockConnectForm({ initialHandle, onConnected }: { initialHandle: string; onConnected: () => void }) {
  const { t } = useI18n();
  const [handle, setHandle] = useState(initialHandle);
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
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-0 flex-1">
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
        <Button type="submit" size="md" disabled={!handle.trim() || connect.isPending}>
          {connect.isPending ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
          {connect.isPending ? t("settings.instagram.connecting") : t("onboarding.instagram.connect")}
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-caption text-danger">
          {error}
        </p>
      )}
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
