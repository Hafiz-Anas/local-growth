import type { FeatureKey } from "@/types";

export type NavIcon =
  | "home"
  | "competitors"
  | "generator"
  | "experiment"
  | "engagement"
  | "assistant"
  | "recommendations"
  | "reports"
  | "settings"
  | "clients"
  | "onboarding"
  | "system";

export interface NavItem {
  href: string;
  /** Translation key under nav.* */
  labelKey: string;
  icon: NavIcon;
  /** When set, the item (and its route) only exist if this feature is ON. */
  feature?: FeatureKey;
  /** Show in the mobile bottom tab bar. */
  mobile?: boolean;
}

export const USER_NAV: NavItem[] = [
  { href: "/dashboard", labelKey: "nav.dashboard", icon: "home", mobile: true },
  { href: "/competitors", labelKey: "nav.competitors", icon: "competitors", feature: "competitors", mobile: true },
  { href: "/post-generator", labelKey: "nav.postGenerator", icon: "generator", feature: "postGenerator", mobile: true },
  { href: "/experiment", labelKey: "nav.experiment", icon: "experiment", feature: "experiment", mobile: true },
  { href: "/engagement", labelKey: "nav.engagement", icon: "engagement", feature: "engagement", mobile: true },
  { href: "/recommendations", labelKey: "nav.recommendations", icon: "recommendations", feature: "recommendations" },
  { href: "/reports", labelKey: "nav.reports", icon: "reports", feature: "reports" },
  { href: "/settings", labelKey: "nav.settings", icon: "settings" },
];

export const ADMIN_NAV: NavItem[] = [
  { href: "/admin", labelKey: "nav.overview", icon: "home", mobile: true },
  { href: "/admin/clients", labelKey: "nav.clients", icon: "clients", mobile: true },
  { href: "/admin/onboarding", labelKey: "nav.onboarding", icon: "onboarding", mobile: true },
  { href: "/admin/system", labelKey: "nav.system", icon: "system", mobile: true },
];

/** Feature required to open a user route. Used by <FeatureRoute> to return not-found. */
export const ROUTE_FEATURES: Record<string, FeatureKey> = Object.fromEntries(
  USER_NAV.filter((item) => item.feature).map((item) => [item.href, item.feature!]),
);

export const HOME_BY_ROLE = {
  admin: "/admin",
  user: "/dashboard",
} as const;
