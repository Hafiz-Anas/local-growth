"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavItem } from "@/config/navigation";
import { useI18n } from "@/lib/i18n/provider";
import { activePage, activeSection } from "@/lib/navigation";
import { cn } from "@/lib/utils";

/**
 * Tabs at the top of a section with more than one page (e.g. Insights: Recommendations · Reports ·
 * Posting experiment), from the same navigation config as the sidebar. Hidden pages never appear.
 */
export function SectionTabs({ nav, homeHref }: { nav: NavItem[]; homeHref: string }) {
  const pathname = usePathname();
  const { t } = useI18n();
  const section = activeSection(nav, pathname, homeHref);
  const current = section ? activePage(section, pathname) : null;
  const activeRef = useRef<HTMLAnchorElement>(null);
  // On phones the row scrolls: keep the current tab in view.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [current?.href]);
  if (!section?.pages || section.pages.length < 2) return null;

  return (
    <nav aria-label={t(section.labelKey)} className="-mx-4 mb-6 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0" data-testid="section-tabs">
      <ul className="flex min-w-max gap-6 border-b border-border">
        {section.pages.map((page) => {
          const active = page.href === current?.href;
          return (
            <li key={page.href}>
              <Link
                ref={active ? activeRef : undefined}
                href={page.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px flex h-11 items-center border-b-2 text-body whitespace-nowrap transition-colors",
                  active ? "border-foreground font-semibold text-foreground" : "border-transparent text-muted hover:text-foreground",
                )}
              >
                {t(page.labelKey)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
