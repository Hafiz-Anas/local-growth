"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavIcon } from "@/components/layout/nav-icon";
import { HOME_HREF, type NavItem } from "@/config/navigation";
import { cn } from "@/lib/gallery/utils";
import { useI18n } from "@/lib/i18n/provider";
import { isActiveItem } from "@/lib/navigation";

/**
 * Phone bottom bar from the design proposal: icons only, the AI tab in the centre in the brand colour.
 * Same sections, labels and icons (NavIcon) as the desktop sidebar.
 */
export function TabBar({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const { t } = useI18n();

  return (
    <nav aria-label={t("nav.main")} className="ge fixed inset-x-0 bottom-0 z-40 border-t bg-ge-background/95 pb-safe backdrop-blur-xl lg:hidden" data-testid="tab-bar">
      <ul className="mx-auto flex h-[52px] max-w-lg items-stretch">
        {items.map((section) => {
          const active = isActiveItem(pathname, section, HOME_HREF);
          if (section.icon === "ai")
            return (
              <li key={section.labelKey} className="flex-1">
                <Link
                  href={section.href}
                  aria-label={t(section.labelKey)}
                  aria-current={active ? "page" : undefined}
                  className="grid h-full place-items-center rounded-lg transition-transform active:scale-90"
                >
                  {/* AI is the heart of the app: the center tab gets the Instagram gradient. */}
                  <span
                    className={cn(
                      "grid h-8 w-12 place-items-center rounded-[11px] bg-ig-gradient text-white transition-shadow",
                      active && "ring-2 ring-ge-brand/30 ring-offset-2 ring-offset-ge-background",
                    )}
                  >
                    <NavIcon name="ai" active={active} className="size-[20px]" strokeWidth={active ? 2.5 : 2} />
                  </span>
                </Link>
              </li>
            );
          return (
            <li key={section.labelKey} className="flex-1">
              <Link
                href={section.href}
                aria-label={t(section.labelKey)}
                aria-current={active ? "page" : undefined}
                className="relative grid h-full place-items-center rounded-lg transition-transform active:scale-90"
              >
                <NavIcon
                  name={section.icon}
                  active={active}
                  className={cn("size-[26px]", active ? "text-ge-foreground" : "text-ge-foreground/80")}
                  strokeWidth={active ? 2.6 : 1.7}
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
