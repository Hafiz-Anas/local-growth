"use client";

import { startTransition, type ReactNode } from "react";
import Link from "next/link";
import { CircleUserRound, Languages, LogOut, Moon, Settings, ShieldCheck, Sun } from "lucide-react";
import { PlanBadge } from "@/components/shared/client-row";
import { useTheme } from "next-themes";
import { Avatar } from "@/components/shared/avatar";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { logOutOf, useDeviceAccounts } from "@/lib/api/device-accounts";
import { logoutAction } from "@/lib/auth/actions";
import { useI18n } from "@/lib/i18n/provider";
import type { MediaTone, PlanId, Role } from "@/types";

export interface MenuUser {
  name: string;
  email: string;
  avatarUrl: string | null;
  initials: string;
  tone: MediaTone;
  role: Role;
  /** Secondary line under the name: "Administrator" or the business handle. */
  secondary: string;
  /** Admins only: their profile page (a business user's profile is the business, edited in Settings). */
  profileHref?: string;
  settingsHref: string;
  /** Users only: the active account ("@handle") — "Log out of @handle" logs out of this login on this device only. */
  accountLabel?: string;
  /** The business's plan (users only), shown in the menu. */
  plan?: PlanId;
  /** Extra links shown in the menu on phones only (where the tab bar has no room). */
  shortcuts?: Array<{ href: string; label: string; icon: ReactNode }>;
}

/** Identity fields resolved on the server; shells add the localized secondary line and links. */
export type MenuUserBase = Pick<MenuUser, "name" | "email" | "avatarUrl" | "initials" | "tone" | "role">;

/** Main-column inset that follows the sidebar width (with a smooth resize). */
export const CONTENT_INSET =
  "transition-[padding] duration-200 ease-out md:ps-(--sidebar-width-collapsed) xl:ps-(--sidebar-width) xl:sidebar-collapsed:ps-(--sidebar-width-collapsed)";

/** Small shield pinned to an admin's avatar corner. */
export function AdminShield() {
  return (
    <span className="flex size-4 items-center justify-center rounded-pill border-2 border-background bg-foreground text-background">
      <ShieldCheck className="size-2.5" strokeWidth={2.5} aria-hidden="true" />
    </span>
  );
}

/** Shared menu body: identity header with role and plan, then profile / settings / theme / language / log out. */
function ProfileMenuBody({ user }: { user: MenuUser }) {
  const { t, locale, setLocale } = useI18n();
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  return (
    <>
      <DropdownMenuLabel className="flex items-center gap-3 py-3">
        <Avatar src={user.avatarUrl} initials={user.initials} tone={user.tone} size="md" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body font-semibold text-foreground">{user.name}</span>
          <span className="block truncate">
            <bdi>{user.email}</bdi>
          </span>
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge variant={user.role === "admin" ? "neutral" : "blue"} size="sm">
              {user.role === "admin" && <ShieldCheck />}
              {user.role === "admin" ? t("roles.admin") : t("roles.user")}
            </Badge>
            {user.plan && <PlanBadge plan={user.plan} className="h-5 px-2 text-[11px]" />}
          </span>
        </span>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      {user.shortcuts?.map((s) => (
        <DropdownMenuItem key={s.href} asChild className="md:hidden" data-testid="menu-shortcut">
          <Link href={s.href}>
            {s.icon}
            {s.label}
          </Link>
        </DropdownMenuItem>
      ))}
      {user.profileHref && (
        <DropdownMenuItem asChild>
          <Link href={user.profileHref}>
            <CircleUserRound />
            {t("topbar.profile")}
          </Link>
        </DropdownMenuItem>
      )}
      <DropdownMenuItem asChild>
        <Link href={user.settingsHref}>
          <Settings />
          {t("topbar.settings")}
        </Link>
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => setTheme(dark ? "light" : "dark")} data-testid="menu-theme">
        {dark ? <Sun /> : <Moon />}
        {dark ? t("topbar.switchToLight") : t("topbar.switchToDark")}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => setLocale(locale === "en" ? "ar" : "en")} data-testid="menu-language">
        <Languages />
        {t("topbar.language")}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      {user.role === "user" && user.accountLabel !== undefined ? (
        <DeviceLogoutItems accountLabel={user.accountLabel} />
      ) : (
        <DropdownMenuItem onSelect={() => startTransition(() => logoutAction())}>
          <LogOut className="rtl:-scale-x-100" />
          {t("topbar.logout")}
        </DropdownMenuItem>
      )}
    </>
  );
}

/** Clients: "Log out of @handle" (moves on to another login remembered here) and, with several, "Log out of all accounts". */
function DeviceLogoutItems({ accountLabel }: { accountLabel: string }) {
  const { t } = useI18n();
  const accounts = useDeviceAccounts();
  return (
    <>
      <DropdownMenuItem onSelect={() => void logOutOf(false)} data-testid="menu-logout">
        <LogOut className="rtl:-scale-x-100" />
        <span className="min-w-0 truncate">
          {t("deviceAccounts.logOutOf")} <bdi>{accountLabel}</bdi>
        </span>
      </DropdownMenuItem>
      {(accounts.data?.items.length ?? 0) > 1 && (
        <DropdownMenuItem onSelect={() => void logOutOf(true)} className="text-danger" data-testid="menu-logout-all">
          <LogOut className="rtl:-scale-x-100" />
          {t("deviceAccounts.logOutAll")}
        </DropdownMenuItem>
      )}
    </>
  );
}

/** Top-bar avatar trigger. */
export function ProfileMenu({ user }: { user: MenuUser }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded-pill outline-none focus-visible:ring-2 focus-visible:ring-primary/40" aria-label={user.name} data-testid="profile-menu-trigger">
        <Avatar src={user.avatarUrl} initials={user.initials} tone={user.tone} size="sm" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <ProfileMenuBody user={user} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Any custom trigger (e.g. the sidebar profile row) opening the same menu above it.
 * The tooltip wraps the dropdown trigger — Radix needs it outermost for both to work.
 */
export function ProfileMenuTrigger({
  user,
  tooltip,
  tooltipSide = "right",
  children,
}: {
  user: MenuUser;
  tooltip?: string;
  tooltipSide?: "left" | "right";
  children: ReactNode;
}) {
  return (
    <DropdownMenu>
      <Tooltip label={tooltip} side={tooltipSide} disabled={!tooltip}>
        <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent side="top" align="start" sideOffset={6}>
        <ProfileMenuBody user={user} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
