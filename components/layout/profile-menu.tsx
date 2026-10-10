"use client";

import { startTransition, type ReactNode } from "react";
import Link from "next/link";
import { CircleUserRound, Languages, LogOut, Moon, Settings, ShieldCheck, Sun } from "lucide-react";
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
import { logoutAction } from "@/lib/auth/actions";
import { useI18n } from "@/lib/i18n/provider";
import type { MediaTone, Role } from "@/types";

export interface MenuUser {
  name: string;
  email: string;
  avatarUrl: string | null;
  initials: string;
  tone: MediaTone;
  role: Role;
  /** Secondary line under the name: "Administrator" or the business handle. */
  secondary: string;
  profileHref: string;
  settingsHref: string;
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

/** Shared menu body: identity header with role, then profile / settings / theme / language / log out. */
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
          <Badge variant={user.role === "admin" ? "neutral" : "blue"} size="sm" className="mt-1.5">
            {user.role === "admin" && <ShieldCheck />}
            {user.role === "admin" ? t("roles.admin") : t("roles.user")}
          </Badge>
        </span>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem asChild>
        <Link href={user.profileHref}>
          <CircleUserRound />
          {t("topbar.profile")}
        </Link>
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <Link href={user.settingsHref}>
          <Settings />
          {t("topbar.settings")}
        </Link>
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => setTheme(dark ? "light" : "dark")}>
        {dark ? <Sun /> : <Moon />}
        {t("topbar.appearance")}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => setLocale(locale === "en" ? "ar" : "en")}>
        <Languages />
        {t("topbar.language")}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => startTransition(() => logoutAction())}>
        <LogOut className="rtl:-scale-x-100" />
        {t("topbar.logout")}
      </DropdownMenuItem>
    </>
  );
}

/** Top-bar avatar trigger. */
export function ProfileMenu({ user }: { user: MenuUser }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded-pill outline-none focus-visible:ring-2 focus-visible:ring-primary/40" aria-label={user.name}>
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
