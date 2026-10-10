"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavItem } from "@/config/navigation";
import { useI18n } from "@/lib/i18n/provider";
import { NavIcon } from "./nav-icon";
import { isActivePath } from "./sidebar";

/** Instagram mobile bottom bar: icons only, evenly spaced. */
export function MobileTabBar({ items, homeHref }: { items: NavItem[]; homeHref: string }) {
  const pathname = usePathname();
  const { t } = useI18n();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background pb-[env(safe-area-inset-bottom)] md:hidden">
      <ul className="flex h-(--tabbar-height) items-center justify-around">
        {items.map((item) => {
          const active = isActivePath(pathname, item.href, item.href === homeHref);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-label={t(item.labelKey)}
                aria-current={active ? "page" : undefined}
                className="group flex size-11 items-center justify-center"
              >
                <NavIcon name={item.icon} active={active} />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
