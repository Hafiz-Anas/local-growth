"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoMark } from "@/components/brand/logo";
import type { NavItem } from "@/config/navigation";
import { SITE } from "@/config/site";
import { useT } from "@/lib/gallery/hooks";
import { cn } from "@/lib/gallery/utils";
import { useI18n } from "@/lib/i18n/provider";
import { isActiveItem } from "@/lib/navigation";
import { HOME_HREF, SECTION_ICONS } from "./nav";

const item = "flex h-12 w-full items-center gap-4 rounded-xl px-3 text-[15px] transition-colors hover:bg-ge-muted";

/** Desktop navigation from the design proposal, like Instagram on the web. Notifications and the profile menu live in the header. */
export function Sidebar({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const { t } = useT();
  const { t: tr } = useI18n();

  return (
    <aside className="ge fixed inset-y-0 start-0 z-40 hidden w-[244px] flex-col border-e bg-ge-background px-3 pt-7 pb-5 lg:flex" data-testid="sidebar">
      <Link href={HOME_HREF} className="mb-8 px-3">
        <span className="flex items-center gap-2">
          <LogoMark className="size-7" />
          <span className="text-[17px] font-semibold tracking-tight" dir="ltr">
            {SITE.name}
          </span>
        </span>
      </Link>
      <nav aria-label={tr("nav.main")} className="flex flex-1 flex-col gap-1">
        {items.map((section) => {
          const Icon = SECTION_ICONS[section.icon];
          if (!Icon) return null;
          const active = isActiveItem(pathname, section, HOME_HREF);
          return (
            <Link key={section.labelKey} href={section.href} aria-current={active ? "page" : undefined} className={cn(item, active && "font-bold")}>
              <span className="relative">
                {section.icon === "ai" ? (
                  <span className="grid size-[26px] place-items-center rounded-lg bg-ge-brand text-ge-primary-foreground">
                    <Icon className="size-4" strokeWidth={active ? 2.6 : 2} />
                  </span>
                ) : (
                  <Icon className="size-[26px]" strokeWidth={active ? 2.6 : 1.8} />
                )}
              </span>
              {tr(section.labelKey)}
            </Link>
          );
        })}
      </nav>
      <p className="px-3 text-[11px] leading-relaxed text-ge-muted-foreground">{t("by")}</p>
    </aside>
  );
}
