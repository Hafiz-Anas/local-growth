"use client";

import { useEffect, useId, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavItem } from "@/config/navigation";
import { useI18n } from "@/lib/i18n/provider";
import { activePage, activeSection } from "@/lib/navigation";
import { cn } from "@/lib/utils";

/**
 * Tabs at the top of a section with more than one page (e.g. Insights: Post performance ·
 * Recommendations · Weekly reports …), from the same navigation config as the sidebar, each with a
 * one-line description under its title when the page has one. Hidden pages never appear.
 */
export function SectionTabs({ nav, homeHref }: { nav: NavItem[]; homeHref: string }) {
  const pathname = usePathname();
  const { t } = useI18n();
  const section = activeSection(nav, pathname, homeHref);
  const current = section ? activePage(section, pathname) : null;
  const activeRef = useRef<HTMLAnchorElement>(null);
  const descriptionId = useId();
  // On phones the row scrolls: keep the current tab in view.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [current?.href]);
  if (!section?.pages || section.pages.length < 2) return null;
  const described = section.pages.some((page) => page.descriptionKey);

  return (
    <nav aria-label={t(section.labelKey)} className="-mx-4 mb-6 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0" data-testid="section-tabs">
      {/* Phones scroll the row; wider screens fit every tab, letting a long description wrap. */}
      <ul className={cn("flex min-w-max gap-6 border-b border-border", described && "md:min-w-0 md:gap-4")}>
        {section.pages.map((page, i) => {
          const active = page.href === current?.href;
          const describedBy = page.descriptionKey ? `${descriptionId}-${i}` : undefined;
          return (
            <li key={page.href} className={cn(described && "md:min-w-0 md:flex-1")}>
              <Link
                ref={active ? activeRef : undefined}
                href={page.href}
                aria-current={active ? "page" : undefined}
                // The title is the tab's name; the line under it is its description.
                aria-label={describedBy ? t(page.labelKey) : undefined}
                aria-describedby={describedBy}
                className={cn(
                  "-mb-px flex flex-col justify-center border-b-2 whitespace-nowrap transition-colors",
                  page.descriptionKey ? "h-full min-h-11 justify-start py-2 md:whitespace-normal" : "h-11",
                  active ? "border-foreground text-foreground" : "border-transparent text-muted hover:text-foreground",
                )}
              >
                <span className={cn("text-body", active && "font-semibold")} data-testid="section-tab-label">
                  {t(page.labelKey)}
                </span>
                {page.descriptionKey && (
                  <span id={describedBy} className="text-caption text-muted">
                    {t(page.descriptionKey)}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
