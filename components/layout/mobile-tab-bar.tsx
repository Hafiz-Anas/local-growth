"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavItem } from "@/config/navigation";
import { useI18n } from "@/lib/i18n/provider";
import { isActiveItem } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { NavIcon } from "./nav-icon";

/** Phone bottom bar: one tab per section (icon + short label), evenly spaced. */
export function MobileTabBar({ items, homeHref }: { items: NavItem[]; homeHref: string }) {
  const pathname = usePathname();
  const { t } = useI18n();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background pb-[env(safe-area-inset-bottom)] md:hidden" aria-label={t("nav.main")} data-testid="tab-bar">
      <ul className="flex h-(--tabbar-height) items-stretch justify-around">
        {items.map((item) => {
          const active = isActiveItem(pathname, item, homeHref);
          return (
            <li key={item.labelKey} className="min-w-0 flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn("group flex h-full flex-col items-center justify-center gap-0.5 px-0.5", active ? "text-foreground" : "text-muted")}
              >
                <NavIcon name={item.icon} active={active} className="size-[22px]" />
                <span className={cn("max-w-full truncate text-[10px] leading-3", active ? "font-bold" : "font-medium")}>{t(item.labelKey)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
