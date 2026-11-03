import { MAX_PHONE_TABS, type NavItem, type NavPage } from "@/config/navigation";

/**
 * Pure helpers over the navigation config (config/navigation.ts), shared by the sidebar, the phone
 * tab bar, the profile menu and the section tabs. Feature filtering is filterNav (lib/permissions).
 */

export function isActivePath(pathname: string, href: string, exact = false) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The pages an item stands for (a section's pages, or the item itself). */
export function pagesOf(item: NavItem): NavPage[] {
  return item.pages?.length ? item.pages : [item];
}

/** Whether the item (or any page of its section) is the current page. `homeHref` only matches exactly. */
export function isActiveItem(pathname: string, item: NavItem, homeHref: string) {
  return pagesOf(item).some((page) => isActivePath(pathname, page.href, page.href === homeHref));
}

/** The section the current page belongs to, or null. */
export function activeSection(nav: NavItem[], pathname: string, homeHref: string): NavItem | null {
  return nav.find((item) => isActiveItem(pathname, item, homeHref)) ?? null;
}

/** The section page the current path belongs to: the most specific match ("/competitors/analysis" over "/competitors"). */
export function activePage(item: NavItem, pathname: string): NavPage | null {
  return (
    pagesOf(item)
      .filter((page) => isActivePath(pathname, page.href))
      .sort((a, b) => b.href.length - a.href.length)[0] ?? null
  );
}

/** Phones: the first sections that fit the tab bar, and the rest for the profile menu (Settings has its own menu entry). */
export function splitForPhone(nav: NavItem[], max = MAX_PHONE_TABS): { tabs: NavItem[]; more: NavItem[] } {
  const eligible = nav.filter((item) => item.mobile !== false);
  return { tabs: eligible.slice(0, max), more: eligible.slice(max) };
}

/**
 * Where a client lands after logging in, switching accounts or finishing onboarding (UX1): the section they chose as
 * their start page when the business still has it, else the usual home (the Gallery, or the first section left).
 */
export function startPageHref(nav: NavItem[], startPage: string | null | undefined): string {
  const chosen = startPage && startPage !== "gallery" ? nav.find((item) => item.icon === startPage && item.placement !== "bottom") : undefined;
  return chosen?.href ?? clientHome(nav);
}

/** A client's landing page: the Gallery, or the first section they have when it's off (Settings at worst). */
export function clientHome(nav: NavItem[]): string {
  return (nav.find((item) => item.icon === "gallery") ?? nav.find((item) => item.placement !== "bottom") ?? nav[0])?.href ?? "/settings";
}
