"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Loader2, Plus } from "lucide-react";
import { Avatar } from "@/components/shared/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { apiFetch, type ApiClientError } from "@/lib/api/client";
import { qk } from "@/lib/api/queries";
import { useI18n } from "@/lib/i18n/provider";
import { cn, formatNumber } from "@/lib/utils";
import { notify } from "@/store/ui-store";
import { errorMessage } from "@/lib/api/errors";
import type { Locale } from "@/config/site";
import type { ConnectionStatus, InstagramAccountDto, InstagramAccountsDto, MediaTone } from "@/types";

const DOT: Record<ConnectionStatus, string> = { connected: "bg-success", needs_attention: "bg-warning", disconnected: "bg-danger" };

/** What the trigger shows before the list has loaded (rendered on the server). */
export interface CurrentAccount {
  handle: string | null;
  name: string;
  avatarUrl: string | null;
  avatarInitials: string;
  avatarTone: MediaTone;
}

/**
 * The Instagram account switcher at the top of the client area (like Instagram's own): the
 * active account's picture and @handle; tapping it lists the login's Instagram accounts with
 * their connection status and unread notifications, plus "Add account" (or, at the plan's
 * limit, a friendly note). Switching loads Home fresh, so nothing of the other account stays
 * on screen. `readOnly` (admin preview) shows the account without the list.
 */
export function AccountSwitcher({ current, readOnly = false, compact = false }: { current: CurrentAccount; readOnly?: boolean; compact?: boolean }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const accounts = useQuery<InstagramAccountsDto, ApiClientError>({
    queryKey: qk.accounts,
    queryFn: () => apiFetch<InstagramAccountsDto>("/api/accounts"),
    enabled: !readOnly,
    refetchInterval: 60_000,
  });
  const go = (href: string) => window.location.assign(href);
  const switchTo = useMutation<{ home: string }, ApiClientError, string>({
    mutationFn: (accountId) => apiFetch("/api/accounts/switch", { method: "POST", body: { accountId } }),
    onSuccess: ({ home }) => go(home),
    onError: (error) => notify.error(errorMessage(error, t)),
    meta: { handlesErrors: true },
  });
  const add = useMutation<{ id: string }, ApiClientError, void>({
    mutationFn: () => apiFetch("/api/accounts", { method: "POST" }),
    onSuccess: () => go("/onboarding"),
    onError: (error) => notify.error(errorMessage(error, t)),
    meta: { handlesErrors: true },
  });
  const busy = switchTo.isPending || add.isPending || switchTo.isSuccess || add.isSuccess;
  const others = accounts.data?.items.filter((a) => !a.active) ?? [];
  const othersUnread = others.reduce((sum, a) => sum + a.unread, 0);
  const label = current.handle ? `@${current.handle}` : current.name || t("accounts.newAccount");

  const identity = (
    <>
      <span className="relative shrink-0">
        <Avatar src={current.avatarUrl} initials={current.avatarInitials} tone={current.avatarTone} size="sm" ring="story" />
        {othersUnread > 0 && (
          <span className="absolute -end-0.5 -top-0.5 size-2.5 rounded-pill border-2 border-background bg-danger" data-testid="account-switcher-dot" aria-hidden="true" />
        )}
      </span>
      <span className={cn("truncate text-body font-semibold", compact ? "max-w-[40vw]" : "max-w-[44vw] sm:max-w-[260px]")}>
        <bdi>{label}</bdi>
      </span>
    </>
  );

  if (readOnly) return <div className="flex min-w-0 items-center gap-2.5" data-testid="account-switcher">{identity}</div>;

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void accounts.refetch();
      }}
    >
      <DropdownMenuTrigger
        className="flex min-w-0 items-center gap-2.5 rounded-button py-1 pe-1 outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-label={t("accounts.switcherLabel", { account: label })}
        data-testid="account-switcher"
      >
        {identity}
        <ChevronDown className="size-4 shrink-0 text-muted" aria-hidden="true" />
        {othersUnread > 0 && <span className="sr-only">{t("accounts.otherUnread", { count: othersUnread })}</span>}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[min(340px,calc(100vw-32px))]" data-testid="account-switcher-menu">
        <DropdownMenuLabel className="px-3 pt-1 pb-2 text-caption font-semibold text-muted">{t("accounts.title")}</DropdownMenuLabel>
        {accounts.isPending ? (
          <div className="space-y-2 p-2" aria-busy="true">
            {[0, 1].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="size-11 animate-pulse rounded-pill bg-secondary-bg" />
                <span className="h-3 w-32 animate-pulse rounded-pill bg-secondary-bg" />
              </div>
            ))}
          </div>
        ) : accounts.isError ? (
          <button type="button" className="w-full p-3 text-start text-caption text-muted" onClick={() => accounts.refetch()}>
            {t("accounts.loadFailed")} <span className="font-semibold text-primary">{t("states.retry")}</span>
          </button>
        ) : (
          <>
            {accounts.data.items.map((account) => (
              <AccountRow
                key={account.id}
                account={account}
                disabled={busy}
                pending={switchTo.isPending && switchTo.variables === account.id}
                onSelect={() => {
                  if (!account.active) switchTo.mutate(account.id);
                }}
                locale={locale}
              />
            ))}
            <DropdownMenuSeparator />
            {accounts.data.canAdd ? (
              <DropdownMenuItem
                disabled={busy}
                onSelect={(event) => {
                  event.preventDefault();
                  add.mutate();
                }}
                className="gap-3 p-3"
                data-testid="account-add"
              >
                <span className="grid size-11 shrink-0 place-items-center rounded-pill border border-border">
                  {add.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Plus aria-hidden="true" />}
                </span>
                <span className="font-semibold">{t("accounts.add")}</span>
              </DropdownMenuItem>
            ) : (
              <p className="p-3 text-caption text-muted" data-testid="account-limit">
                {t(accounts.data.limit === 1 ? "accounts.limitOne" : "accounts.limitMany", { limit: formatNumber(accounts.data.limit, locale) })}
              </p>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AccountRow({ account, disabled, pending, onSelect, locale }: { account: InstagramAccountDto; disabled: boolean; pending: boolean; onSelect: () => void; locale: Locale }) {
  const { t } = useI18n();
  const status = account.setupInProgress && account.connection === "disconnected" ? t("accounts.settingUp") : t(`connection.${account.connection}`);
  return (
    <DropdownMenuItem
      disabled={disabled && !account.active}
      onSelect={(event) => {
        if (!account.active) event.preventDefault();
        onSelect();
      }}
      className="gap-3 p-3"
      aria-current={account.active ? "true" : undefined}
      data-testid="account-row"
      data-account-id={account.id}
    >
      <Avatar src={account.avatarUrl} initials={account.avatarInitials} tone={account.avatarTone} size="md" />
      <span className="min-w-0 flex-1 leading-5">
        <span className="block truncate font-semibold">
          <bdi>{account.handle ? `@${account.handle}` : account.name || t("accounts.newAccount")}</bdi>
        </span>
        <span className="flex items-center gap-1.5 text-caption text-muted">
          <span className={cn("size-2 shrink-0 rounded-pill", account.setupInProgress && account.connection === "disconnected" ? "bg-muted" : DOT[account.connection])} aria-hidden="true" />
          {status}
        </span>
      </span>
      {account.unread > 0 && (
        <span
          className="grid h-5 min-w-5 shrink-0 place-items-center rounded-pill bg-danger px-1.5 text-[11px] font-semibold text-white tabular-nums"
          aria-label={t("accounts.unread", { count: account.unread })}
          data-testid="account-unread"
        >
          {account.unread > 99 ? "99+" : formatNumber(account.unread, locale)}
        </span>
      )}
      {pending ? (
        <Loader2 className="shrink-0 animate-spin text-muted" aria-hidden="true" />
      ) : account.active ? (
        <Check className="shrink-0 text-primary" aria-label={t("accounts.active")} />
      ) : null}
    </DropdownMenuItem>
  );
}
