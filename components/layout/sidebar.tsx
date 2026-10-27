"use client";

import { forwardRef, type ComponentPropsWithoutRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { NavItem } from "@/config/navigation";
import { LogoMark, Wordmark } from "@/components/brand/logo";
import { Avatar } from "@/components/shared/avatar";
import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n/provider";
import { isActiveItem } from "@/lib/navigation";
import { setSidebarCollapsed, useSidebarCollapsed, useSidebarIconOnly } from "@/lib/sidebar";
import { cn } from "@/lib/utils";
import { NavIcon } from "./nav-icon";
import { AdminShield, ProfileMenuTrigger, type MenuUser } from "./profile-menu";

/*
 * Width/visibility is pure CSS so the saved state applies before paint:
 *  - below `from` (768px admin, 1024px client): hidden (bottom tab bar)
 *  - from there to 1279px: icon rail (auto-collapsed)
 *  - ≥1280px: expanded, unless <html data-sidebar="collapsed">
 */
const SHOW_WHEN_EXPANDED = "opacity-0 xl:opacity-100 xl:sidebar-collapsed:opacity-0";
const SHOW_WHEN_COLLAPSED = "opacity-100 xl:opacity-0 xl:sidebar-collapsed:opacity-100";
const FADE = "transition-opacity duration-200 ease-out";
const SHOW_FROM = { md: "md:flex", lg: "lg:flex" } as const;

/** The client shell's main column and fixed bars start beside the sidebar (from 1024px, where the phone tab bar goes). */
export const CLIENT_CONTENT_INSET =
  "transition-[padding] duration-200 ease-out lg:ps-(--sidebar-width-collapsed) xl:ps-(--sidebar-width) xl:sidebar-collapsed:ps-(--sidebar-width-collapsed)";
export const CLIENT_FIXED_START = "lg:start-(--sidebar-width-collapsed) xl:start-(--sidebar-width) xl:sidebar-collapsed:start-(--sidebar-width-collapsed)";

/** Instagram web sidebar with collapse toggle and a profile row at the bottom. */
export function Sidebar({
  items,
  bottomItems = [],
  homeHref,
  user,
  from = "md",
}: {
  items: NavItem[];
  bottomItems?: NavItem[];
  homeHref: string;
  user: MenuUser;
  /** Where the sidebar takes over from the phone tab bar. */
  from?: keyof typeof SHOW_FROM;
}) {
  const pathname = usePathname();
  const { t, dir } = useI18n();
  const collapsed = useSidebarCollapsed();
  const iconOnly = useSidebarIconOnly();
  const tooltipSide = dir === "rtl" ? "left" : "right";

  const renderItem = (item: NavItem) => {
    // A section is active on any of its pages (e.g. Insights on Reports).
    const active = isActiveItem(pathname, item, homeHref);
    const label = t(item.labelKey);
    return (
      <li key={item.labelKey}>
        <Tooltip label={label} side={tooltipSide} disabled={!iconOnly}>
          <Link href={item.href} aria-current={active ? "page" : undefined} aria-label={iconOnly ? label : undefined} className={ROW}>
            {item.icon === "ai" ? (
              // The AI section gets the Instagram gradient.
              <span className="grid size-6 shrink-0 place-items-center rounded-[7px] bg-ig-gradient text-white transition-transform group-hover:scale-105">
                <NavIcon name="ai" active={active} className="size-4 group-hover:scale-100" />
              </span>
            ) : (
              <NavIcon name={item.icon} active={active} />
            )}
            <span className={cn("truncate text-title", active ? "font-bold" : "font-normal", SHOW_WHEN_EXPANDED, FADE)}>{label}</span>
          </Link>
        </Tooltip>
      </li>
    );
  };

  const toggleLabel = collapsed ? t("sidebar.expand") : t("sidebar.collapse");
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const profileTooltip = `${user.name} · ${user.secondary}`;

  return (
    <aside
      className={cn(
        "fixed inset-y-0 start-0 z-30 hidden flex-col overflow-x-hidden border-e border-border bg-background px-3 pt-2 pb-4",
        SHOW_FROM[from],
        "w-(--sidebar-width-collapsed) xl:w-(--sidebar-width) xl:sidebar-collapsed:w-(--sidebar-width-collapsed)",
        "transition-[width] duration-200 ease-out",
      )}
      data-testid="sidebar"
    >
      <Link href={homeHref} className="relative mb-5 flex h-[73px] shrink-0 items-center px-3 pt-4" aria-label="AI Growth Engine">
        <LogoMark className={cn("absolute size-7", SHOW_WHEN_COLLAPSED, FADE)} />
        <Wordmark className={cn("text-[22px] whitespace-nowrap", SHOW_WHEN_EXPANDED, FADE)} />
      </Link>

      <nav className="flex min-h-0 flex-1 flex-col">
        <ul className="flex-1">{items.map(renderItem)}</ul>
        <ul>
          {bottomItems.map(renderItem)}
          <li className="hidden xl:block">
            <Tooltip label={toggleLabel} side={tooltipSide} disabled={!iconOnly}>
              <button
                type="button"
                onClick={() => setSidebarCollapsed(!collapsed)}
                aria-label={toggleLabel}
                aria-expanded={!collapsed}
                className={cn(ROW, "w-full")}
              >
                <ToggleIcon className="size-6 shrink-0 rtl:-scale-x-100" strokeWidth={1.75} aria-hidden="true" />
                <span className={cn("truncate text-title", SHOW_WHEN_EXPANDED, FADE)}>{toggleLabel}</span>
              </button>
            </Tooltip>
          </li>
        </ul>
      </nav>

      <div className="mt-2 border-t border-separator pt-2">
        <ProfileMenuTrigger user={user} tooltip={iconOnly ? profileTooltip : undefined} tooltipSide={tooltipSide}>
          <ProfileRowButton user={user} />
        </ProfileMenuTrigger>
      </div>
    </aside>
  );
}

const ROW = "group my-0.5 flex h-12 items-center gap-4 rounded-button p-3 text-start whitespace-nowrap transition-colors hover:bg-hover";

/** The bottom profile row: avatar + name + muted secondary line (role or handle). */
const ProfileRowButton = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<"button"> & { user: MenuUser }>(function ProfileRowButton(
  { user, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      {...props}
      aria-label={`${user.name} · ${user.secondary}`}
      data-testid="sidebar-profile"
      className="flex w-full items-center gap-3 rounded-button px-2 py-2 text-start whitespace-nowrap transition-colors outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <Avatar
        src={user.avatarUrl}
        initials={user.initials}
        tone={user.tone}
        size="sm"
        badge={
          user.role === "admin" ? (
            <span className={cn("block", SHOW_WHEN_COLLAPSED, FADE)}>
              <AdminShield />
            </span>
          ) : undefined
        }
      />
      <span className={cn("min-w-0 flex-1 leading-4", SHOW_WHEN_EXPANDED, FADE)}>
        <span className="block truncate text-body font-semibold">{user.name}</span>
        <bdi className="block truncate text-caption text-muted">{user.secondary}</bdi>
      </span>
    </button>
  );
});
