"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, ChevronDown, Loader2, LogIn, LogOut, Plus, UserPlus, X } from "lucide-react";
import { Avatar } from "@/components/shared/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { LOGIN_HAS_SEVERAL_ACCOUNTS } from "@/config/accounts";
import { apiFetch, type ApiClientError } from "@/lib/api/client";
import { logOutOf, openAddAccount, useDeviceAccounts } from "@/lib/api/device-accounts";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/queries";
import { useI18n } from "@/lib/i18n/provider";
import { cn, formatNumber } from "@/lib/utils";
import { notify } from "@/store/ui-store";
import type { ConnectionStatus, DeviceAccountDto, DeviceAccountsDto } from "@/types";
import { AccountSwitcher, type CurrentAccount } from "./account-switcher";

const DOT: Record<ConnectionStatus, string> = { connected: "bg-success", needs_attention: "bg-warning", disconnected: "bg-danger" };

/** The account switcher at the top of the client area and the set-up screens (config/accounts.ts picks which). */
export function ActiveAccountSwitcher({ look, ...props }: { current: CurrentAccount; readOnly?: boolean; compact?: boolean; look?: "proposal" }) {
  return LOGIN_HAS_SEVERAL_ACCOUNTS ? <AccountSwitcher {...props} /> : <LoginSwitcher {...props} look={look} />;
}

const labelOf = (a: { handle: string | null; name: string }, fallback: string) => (a.handle ? `@${a.handle}` : a.name || fallback);

/**
 * Instagram-style account switcher where each account is its own login: the active account's picture and
 * @handle; tapping it opens the logins remembered on this browser (picture, @handle, connection status),
 * "Add account" (log in to an existing account or create a new one — this login stays remembered),
 * "Log out of @handle" and "Log out of all accounts"; each other account can be removed from this device.
 * Switching signs in on the server and loads Home fresh, where a "Switched to @handle" toast shows.
 * `readOnly` (admin preview) shows the account without the list. Phones get a bottom sheet.
 */
/** `look="proposal"`: the design proposal's header trigger (bold @handle and a chevron, no picture). */
export function LoginSwitcher({
  current,
  readOnly = false,
  compact = false,
  look,
}: {
  current: CurrentAccount;
  readOnly?: boolean;
  compact?: boolean;
  look?: "proposal";
}) {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"list" | "add">("list");
  const [confirming, setConfirming] = useState<string | null>(null);
  const accounts = useDeviceAccounts(!readOnly);
  const label = labelOf(current, t("deviceAccounts.newAccount"));

  const switchTo = useMutation<{ to: string }, ApiClientError, string>({
    mutationFn: (loginId) => apiFetch("/api/device-accounts/switch", { method: "POST", body: { loginId } }),
    onSuccess: ({ to }) => window.location.assign(to),
    onError: (error) => {
      notify.error(errorMessage(error, t));
      void accounts.refetch();
    },
    meta: { handlesErrors: true },
  });
  const remove = useMutation<unknown, ApiClientError, DeviceAccountDto>({
    mutationFn: (account) => apiFetch(`/api/device-accounts/${account.id}`, { method: "DELETE" }),
    onSuccess: (_data, account) => {
      setConfirming(null);
      queryClient.setQueryData<DeviceAccountsDto>(qk.deviceAccounts, (prev) =>
        prev ? { ...prev, items: prev.items.filter((a) => a.id !== account.id), canAdd: true } : prev,
      );
      notify.success(t("deviceAccounts.removed", { account: labelOf(account, t("deviceAccounts.newAccount")) }));
    },
    onError: (error) => {
      notify.error(errorMessage(error, t));
      void accounts.refetch();
    },
    meta: { handlesErrors: true },
  });
  const [leaving, setLeaving] = useState<"one" | "all" | null>(null);
  const logout = (all: boolean) => {
    setLeaving(all ? "all" : "one");
    void logOutOf(all);
  };
  const busy = switchTo.isPending || switchTo.isSuccess || remove.isPending || leaving !== null;
  const items = accounts.data?.items ?? [];

  const proposal = look === "proposal";
  const identity = proposal ? (
    <span className="truncate text-[17px] font-bold tracking-tight" dir="ltr">
      {label}
    </span>
  ) : (
    <>
      <Avatar src={current.avatarUrl} initials={current.avatarInitials} tone={current.avatarTone} size="sm" ring="story" />
      <span className={cn("truncate text-body font-semibold", compact ? "max-w-[40vw]" : "max-w-[44vw] sm:max-w-[260px]")}>
        <bdi>{label}</bdi>
      </span>
    </>
  );

  if (readOnly) return <div className={cn("flex min-w-0 items-center", proposal ? "px-1.5 py-1" : "gap-2.5")} data-testid="account-switcher">{identity}</div>;

  return (
    <>
      <button
        type="button"
        className={
          proposal
            ? "flex min-w-0 items-center gap-1 rounded-lg px-1.5 py-1 hover:bg-ge-muted"
            : "flex min-w-0 items-center gap-2.5 rounded-button py-1 pe-1 outline-none focus-visible:ring-2 focus-visible:ring-primary"
        }
        aria-label={t("deviceAccounts.switcherLabel", { account: label })}
        aria-haspopup="dialog"
        onClick={() => {
          setView("list");
          setConfirming(null);
          setOpen(true);
          void accounts.refetch();
        }}
        data-testid="account-switcher"
      >
        {identity}
        {proposal ? <ChevronDown className="size-4 shrink-0" strokeWidth={2.5} aria-hidden="true" /> : <ChevronDown className="size-4 shrink-0 text-muted" aria-hidden="true" />}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:pb-[env(safe-area-inset-bottom)]"
          data-testid="account-switcher-menu"
        >
          {view === "add" ? (
            <div className="p-4 pt-3">
              <div className="mb-3 flex items-center gap-2 pe-8">
                <button type="button" onClick={() => setView("list")} className="rounded-pill p-1 hover:bg-hover" aria-label={t("deviceAccounts.back")}>
                  <ArrowLeft className="size-5 rtl:-scale-x-100" aria-hidden="true" />
                </button>
                <DialogTitle className="text-title">{t("deviceAccounts.addTitle")}</DialogTitle>
              </div>
              <DialogDescription className="mb-4 text-caption">{t("deviceAccounts.addHint", { account: label })}</DialogDescription>
              <div className="space-y-2">
                <AddChoice icon={<LogIn className="rtl:-scale-x-100" />} title={t("deviceAccounts.logIn")} hint={t("deviceAccounts.logInHint")} onClick={() => openAddAccount("login")} testId="account-add-login" />
                <AddChoice icon={<UserPlus />} title={t("deviceAccounts.create")} hint={t("deviceAccounts.createHint")} onClick={() => openAddAccount("signup")} testId="account-add-signup" />
              </div>
            </div>
          ) : (
            <>
              <div className="border-b border-separator px-4 py-3 pe-12">
                <DialogTitle className="text-title">{t("deviceAccounts.title")}</DialogTitle>
                <DialogDescription className="text-caption">{t("deviceAccounts.hint")}</DialogDescription>
              </div>
              <div className="max-h-[60dvh] overflow-y-auto py-1">
                {accounts.isPending ? (
                  <div className="space-y-3 p-4" aria-busy="true">
                    {[0, 1].map((i) => (
                      <div key={i} className="flex items-center gap-3">
                        <span className="size-11 animate-pulse rounded-pill bg-secondary-bg" />
                        <span className="h-3 w-32 animate-pulse rounded-pill bg-secondary-bg" />
                      </div>
                    ))}
                  </div>
                ) : accounts.isError ? (
                  <button type="button" className="w-full p-4 text-start text-caption text-muted" onClick={() => accounts.refetch()}>
                    {t("deviceAccounts.loadFailed")} <span className="font-semibold text-primary">{t("states.retry")}</span>
                  </button>
                ) : (
                  items.map((account) =>
                    confirming === account.id ? (
                      <div key={account.id} className="mx-2 my-1 rounded-card bg-secondary-bg p-3" data-testid="account-remove-confirm">
                        <p className="text-body font-semibold">
                          {t("deviceAccounts.removeConfirm", { account: labelOf(account, t("deviceAccounts.newAccount")) })}
                        </p>
                        <p className="mt-0.5 text-caption text-muted">{t("deviceAccounts.removeHint")}</p>
                        <div className="mt-3 flex gap-2">
                          <Button size="sm" variant="secondary" className="text-danger" disabled={remove.isPending} onClick={() => remove.mutate(account)} data-testid="account-remove-yes">
                            {remove.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : t("deviceAccounts.removeAction")}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                            {t("deviceAccounts.cancel")}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <AccountRow
                        key={account.id}
                        account={account}
                        disabled={busy}
                        pending={switchTo.isPending && switchTo.variables === account.id}
                        onSelect={() => (account.active ? setOpen(false) : switchTo.mutate(account.id))}
                        onRemove={() => setConfirming(account.id)}
                      />
                    ),
                  )
                )}
              </div>
              <div className="border-t border-separator py-1">
                {accounts.data && !accounts.data.canAdd ? (
                  <p className="px-4 py-3 text-caption text-muted" data-testid="account-device-full">
                    {t("deviceAccounts.full", { max: formatNumber(accounts.data.max, locale) })}
                  </p>
                ) : (
                  <MenuButton disabled={busy || accounts.isPending} onClick={() => setView("add")} testId="account-add">
                    <span className="grid size-11 shrink-0 place-items-center rounded-pill border border-border">
                      <Plus aria-hidden="true" />
                    </span>
                    <span className="font-semibold">{t("deviceAccounts.add")}</span>
                  </MenuButton>
                )}
              </div>
              <div className="border-t border-separator py-1">
                <MenuButton disabled={busy} onClick={() => logout(false)} testId="account-logout">
                  {leaving === "one" ? <Loader2 className="size-5 animate-spin" aria-hidden="true" /> : <LogOut className="size-5 rtl:-scale-x-100" aria-hidden="true" />}
                  <span>
                    {t("deviceAccounts.logOutOf")} <bdi>{label}</bdi>
                  </span>
                </MenuButton>
                {items.length > 1 && (
                  <MenuButton disabled={busy} onClick={() => logout(true)} testId="account-logout-all" className="text-danger">
                    {leaving === "all" ? <Loader2 className="size-5 animate-spin" aria-hidden="true" /> : <LogOut className="size-5 rtl:-scale-x-100" aria-hidden="true" />}
                    <span>{t("deviceAccounts.logOutAll")}</span>
                  </MenuButton>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function MenuButton({ children, onClick, disabled, testId, className }: { children: ReactNode; onClick: () => void; disabled?: boolean; testId?: string; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn("flex min-h-12 w-full items-center gap-3 px-4 py-2 text-start text-body hover:bg-hover disabled:opacity-50", className)}
      data-testid={testId}
    >
      {children}
    </button>
  );
}

function AddChoice({ icon, title, hint, onClick, testId }: { icon: ReactNode; title: string; hint: string; onClick: () => void; testId: string }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-card border border-border p-3 text-start hover:bg-hover [&_svg]:size-5" data-testid={testId}>
      <span className="grid size-10 shrink-0 place-items-center rounded-pill bg-secondary-bg">{icon}</span>
      <span className="min-w-0">
        <span className="block font-semibold">{title}</span>
        <span className="block text-caption text-muted">{hint}</span>
      </span>
    </button>
  );
}

function AccountRow({ account, disabled, pending, onSelect, onRemove }: { account: DeviceAccountDto; disabled: boolean; pending: boolean; onSelect: () => void; onRemove: () => void }) {
  const { t } = useI18n();
  const label = labelOf(account, t("deviceAccounts.newAccount"));
  const settingUp = account.setupInProgress && account.connection === "disconnected";
  return (
    <div className="flex items-center gap-1 pe-2 hover:bg-hover" data-testid="account-row" data-active={account.active ? "true" : undefined}>
      <button
        type="button"
        disabled={disabled && !account.active}
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-3 py-2.5 ps-4 text-start disabled:opacity-60"
        aria-current={account.active ? "true" : undefined}
        aria-label={account.active ? `${label} · ${t("deviceAccounts.active")}` : t("deviceAccounts.switchTo", { account: label })}
      >
        <Avatar src={account.avatarUrl} initials={account.avatarInitials} tone={account.avatarTone} size="md" />
        <span className="min-w-0 flex-1 leading-5">
          <span className="block truncate font-semibold">
            <bdi>{label}</bdi>
          </span>
          <span className="flex items-center gap-1.5 text-caption text-muted" data-testid="account-status">
            <span className={cn("size-2 shrink-0 rounded-pill", settingUp ? "bg-muted" : DOT[account.connection])} aria-hidden="true" />
            {settingUp ? t("deviceAccounts.settingUp") : t(`connection.${account.connection}`)}
          </span>
        </span>
        {pending ? <Loader2 className="size-5 shrink-0 animate-spin text-muted" aria-hidden="true" /> : account.active ? <Check className="size-5 shrink-0 text-primary" aria-hidden="true" /> : null}
      </button>
      {!account.active && (
        <button
          type="button"
          disabled={disabled}
          onClick={onRemove}
          className="grid size-9 shrink-0 place-items-center rounded-pill text-muted hover:bg-secondary-bg hover:text-foreground disabled:opacity-50"
          aria-label={t("deviceAccounts.remove", { account: label })}
          data-testid="account-remove"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
