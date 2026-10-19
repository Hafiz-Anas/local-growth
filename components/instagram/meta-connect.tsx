"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CircleCheck, Info, Loader2 } from "lucide-react";
import { Avatar } from "@/components/shared/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { apiFetch, type ApiClientError } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/provider";
import { cn, formatCompact, initials, toneFor } from "@/lib/utils";
import type { InstagramConnectionDto, MetaConnectOutcome, MetaPageOptionDto } from "@/types";

/**
 * Facebook Login for Business ("Instagram API with Facebook Login"), shared by
 * sign-up (/signup/instagram), onboarding and Settings. The browser goes to
 * /api/integrations/instagram/start, Meta sends it back to the page with
 * ?instagram=<outcome>, and these components explain the outcome (picker for
 * several accounts, help when there is no business account, calm message on cancel).
 */

export type ReturnTo = "signup" | "onboarding" | "settings";

const OUTCOMES: MetaConnectOutcome[] = ["connected", "cancelled", "pick", "no_account", "taken", "already_added", "declined", "unavailable", "expired", "error"];

/** Where the browser goes to start Facebook Login. `rerequest` asks again for declined permissions. */
export function metaStartHref(returnTo: ReturnTo, rerequest = false) {
  const params = new URLSearchParams({ returnTo, ...(rerequest && { rerequest: "1" }) });
  return `/api/integrations/instagram/start?${params}`;
}

/** The ?instagram=… outcome Meta's redirect brought back, and a way to clear it from the URL. */
export function useMetaOutcome() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = params.get("instagram");
  const outcome = OUTCOMES.includes(raw as MetaConnectOutcome) ? (raw as MetaConnectOutcome) : null;
  const clear = () => {
    const next = new URLSearchParams(params);
    next.delete("instagram");
    next.delete("username");
    const query = next.toString();
    router.replace(`${pathname}${query ? `?${query}` : ""}${pathname === "/settings" ? "#instagram" : ""}`, { scroll: false });
  };
  return { outcome, username: params.get("username"), clear };
}

/** "Continue with Facebook" / "Reconnect Instagram" — a full-page navigation to Meta. */
export function MetaConnectButton({
  returnTo,
  label,
  rerequest = false,
  variant = "primary",
  size = "md",
  disabled,
  className,
}: {
  returnTo: ReturnTo;
  label?: string;
  rerequest?: boolean;
  variant?: "primary" | "secondary";
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const [leaving, setLeaving] = useState(false);
  // Back from Facebook via the browser's back button restores this page from cache: re-enable the button.
  useEffect(() => {
    const reset = (event: PageTransitionEvent) => event.persisted && setLeaving(false);
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);
  const content = (
    <>
      {leaving ? <Loader2 className="size-4 animate-spin" /> : <FacebookMark className="size-4" />}
      {leaving ? t("instagramConnect.redirecting") : (label ?? t("instagramConnect.continueWithFacebook"))}
    </>
  );
  if (disabled || leaving) {
    return (
      <Button variant={variant} size={size} className={className} disabled>
        {content}
      </Button>
    );
  }
  // A plain link: the start route answers with a redirect to Facebook (full-page navigation, not a fetch).
  return (
    <Button asChild variant={variant} size={size} className={className}>
      <a href={metaStartHref(returnTo, rerequest)} onClick={() => setLeaving(true)}>
        {content}
      </a>
    </Button>
  );
}

function FacebookMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d="M24 12.07C24 5.41 18.63 0 12 0S0 5.41 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.04V9.41c0-3.02 1.8-4.7 4.54-4.7 1.31 0 2.68.24 2.68.24v2.97h-1.5c-1.5 0-1.96.93-1.96 1.89v2.26h3.33l-.53 3.49h-2.8V24C19.62 23.1 24 18.1 24 12.07Z" />
    </svg>
  );
}

/** Friendly permission names ("instagram_manage_comments" → "reply to comments"). */
export function usePermissionNames() {
  const { t } = useI18n();
  return (permissions: string[]) => permissions.map((p) => t(`instagramConnect.permissionNames.${p}`)).join(", ");
}

/**
 * The message for an outcome (except "connected" and "pick", which the caller
 * handles: a success state and the picker). "no_account" shows the setup help.
 */
export function MetaOutcomeNotice({ outcome, returnTo, onDismiss, className }: { outcome: MetaConnectOutcome; returnTo: ReturnTo; onDismiss: () => void; className?: string }) {
  const { t } = useI18n();
  if (outcome === "connected" || outcome === "pick") return null;
  if (outcome === "no_account") return <NoBusinessAccountHelp returnTo={returnTo} onDismiss={onDismiss} className={className} />;
  const calm = outcome === "cancelled";
  return (
    <div role={calm ? "status" : "alert"} className={cn("flex items-start gap-2 rounded-card p-3 text-caption", calm ? "bg-secondary-bg" : "bg-danger/10", className)}>
      {calm ? <Info className="mt-px size-4 shrink-0 text-muted" aria-hidden="true" /> : <AlertTriangle className="mt-px size-4 shrink-0 text-danger" aria-hidden="true" />}
      <p className="min-w-0 flex-1">{t(`instagramConnect.outcomes.${outcome}`)}</p>
      <button type="button" onClick={onDismiss} className="shrink-0 font-semibold text-primary hover:text-link">
        {t("common.dismiss")}
      </button>
    </div>
  );
}

/** No Facebook Page with an Instagram professional account: how to set one up, then "Try again". */
export function NoBusinessAccountHelp({ returnTo, onDismiss, className }: { returnTo: ReturnTo; onDismiss?: () => void; className?: string }) {
  const { t } = useI18n();
  return (
    <div role="alert" className={cn("rounded-panel border border-border p-4", className)}>
      <p className="text-body font-semibold">{t("instagramConnect.noAccount.title")}</p>
      <p className="mt-1 text-caption text-muted">{t("instagramConnect.noAccount.body")}</p>
      <ol className="mt-3 list-decimal space-y-1.5 ps-5 text-caption">
        <li>{t("instagramConnect.noAccount.step1")}</li>
        <li>{t("instagramConnect.noAccount.step2")}</li>
        <li>{t("instagramConnect.noAccount.step3")}</li>
      </ol>
      <div className="mt-4 flex flex-wrap gap-2">
        <MetaConnectButton returnTo={returnTo} label={t("instagramConnect.noAccount.tryAgain")} size="sm" />
        {onDismiss && (
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            {t("common.dismiss")}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * One Facebook login found several Instagram accounts: pick one (Page name,
 * handle, avatar). Closing the dialog cancels the pending login.
 */
export function MetaAccountPicker({ open, onClose, onConnected }: { open: boolean; onClose: () => void; onConnected: (result: { outcome: MetaConnectOutcome; username: string | null; connection: InstagramConnectionDto }) => void }) {
  const { t, locale } = useI18n();
  const options = useQuery<MetaPageOptionDto[], ApiClientError>({
    queryKey: ["instagram", "pending-options"],
    queryFn: () => apiFetch("/api/integrations/instagram/pending"),
    enabled: open,
    retry: false,
    staleTime: 0,
  });
  const pick = useMutation<{ outcome: MetaConnectOutcome; username: string | null; connection: InstagramConnectionDto }, ApiClientError, string>({
    meta: { handlesErrors: true },
    mutationFn: (pageId) => apiFetch("/api/integrations/instagram/pending", { method: "POST", body: { pageId } }),
    onSuccess: onConnected,
  });
  const cancel = () => {
    if (pick.isPending) return;
    void apiFetch("/api/integrations/instagram/pending", { method: "DELETE" }).catch(() => undefined);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && cancel()}>
      <DialogContent className="max-w-[440px]">
        <div className="px-5 pt-5 pb-2">
          <DialogTitle className="text-title">{t("instagramConnect.picker.title")}</DialogTitle>
          <DialogDescription className="mt-1 text-caption text-muted">{t("instagramConnect.picker.body")}</DialogDescription>
        </div>
        <div className="max-h-[60vh] overflow-y-auto px-3 pb-4">
          {options.isPending && (
            <div className="flex justify-center py-8">
              <Loader2 className="size-5 animate-spin text-muted" />
            </div>
          )}
          {options.isError && <p className="px-2 py-6 text-center text-caption text-danger">{t("instagramConnect.picker.expired")}</p>}
          {pick.isError && <p className="px-2 pb-2 text-caption text-danger">{errorMessage(pick.error, t)}</p>}
          <ul className="space-y-1">
            {options.data?.map((o) => (
              <li key={o.pageId}>
                <button
                  type="button"
                  disabled={pick.isPending}
                  onClick={() => pick.mutate(o.pageId)}
                  className="flex w-full items-center gap-3 rounded-card p-2 text-start hover:bg-hover disabled:opacity-60"
                >
                  <Avatar src={o.pictureUrl} initials={initials(o.username || o.pageName)} tone={toneFor(o.username || o.pageId)} size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-semibold" dir="ltr">
                      @{o.username}
                    </span>
                    <span className="block truncate text-caption text-muted">
                      {t("instagramConnect.picker.page", { name: o.pageName })} · {t("instagramConnect.picker.followers", { count: formatCompact(o.followers, locale) })}
                    </span>
                  </span>
                  {pick.isPending && pick.variables === o.pageId ? <Loader2 className="size-4 animate-spin" /> : <span className="text-body font-semibold text-primary">{t("instagramConnect.picker.connect")}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Missing permissions on a working connection, with "Reconnect and allow". */
export function MissingPermissionsNotice({ permissions, returnTo, className }: { permissions: string[]; returnTo: ReturnTo; className?: string }) {
  const { t } = useI18n();
  const names = usePermissionNames();
  if (!permissions.length) return null;
  return (
    <div role="status" className={cn("rounded-card bg-warning/12 p-3 text-caption", className)}>
      <p className="flex items-start gap-2">
        <AlertTriangle className="mt-px size-4 shrink-0 text-warning" aria-hidden="true" />
        <span>
          <span className="font-semibold">{t("instagramConnect.permissions.title")}</span> {t("instagramConnect.permissions.body", { list: names(permissions) })}
        </span>
      </p>
      <MetaConnectButton returnTo={returnTo} rerequest variant="secondary" size="sm" label={t("instagramConnect.permissions.reconnect")} className="mt-2" />
    </div>
  );
}

/** Success line after connecting through Meta. */
export function ConnectedNotice({ username, onDismiss }: { username: string | null; onDismiss: () => void }) {
  const { t } = useI18n();
  return (
    <div role="status" className="flex items-center gap-2 rounded-card bg-success/10 p-3 text-caption">
      <CircleCheck className="size-4 shrink-0 text-success" aria-hidden="true" />
      <p className="min-w-0 flex-1">{username ? t("instagramConnect.outcomes.connectedAs", { username }) : t("instagramConnect.outcomes.connected")}</p>
      <button type="button" onClick={onDismiss} className="shrink-0 font-semibold text-primary hover:text-link">
        {t("common.dismiss")}
      </button>
    </div>
  );
}

