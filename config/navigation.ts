import { SHOW_STATISTICS } from "@/config/insights";
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
  | "insights"
  | "settings"
  | "clients"
  | "onboarding"
  | "system";

/** One page of a section: shown as a tab at the top of the section when it has more than one. */
export interface NavPage {
  href: string;
  /** Translation key under nav.* */
  labelKey: string;
  /** Translation key of the one-line description shown under the tab title. */
  descriptionKey?: string;
  /** When set, the page (and its route) only exist if this feature is ON. */
  feature?: FeatureKey;
}

export interface NavItem {
  /** For a section: its first visible page (filterNav sets it). */
  href: string;
  /** Translation key under nav.* */
  labelKey: string;
  icon: NavIcon;
  /** When set, the item (and its route) only exist if this feature is ON. */
  feature?: FeatureKey;
  /** A section's pages, in tab order. Hidden pages are removed; a section without visible pages is removed. */
  pages?: NavPage[];
  /**
   * Phone tab bar. Admin: shown when true. User sections: shown unless false, in order, up to
   * MAX_PHONE_TABS; the rest go to the profile menu on phones.
   */
  mobile?: boolean;
  /** "bottom": pinned to the bottom of the sidebar (Settings). */
  placement?: "bottom";
}

/** Phone tab bar slots (Instagram has five). */
export const MAX_PHONE_TABS = 5;

/**
 * The client app's sections — the single source for the sidebar, the phone tab bar, the profile
 * menu on phones and the tabs at the top of a section. To add a page, add one entry to a section's
 * `pages` (it becomes a tab there) or add a section. Pages keep their own URLs, so links from notifications and emails don't change.
 */
export const USER_NAV: NavItem[] = [
  { href: "/dashboard", labelKey: "nav.home", icon: "home", pages: [{ href: "/dashboard", labelKey: "nav.home" }] },
  {
    href: "/post-generator",
    labelKey: "nav.posts",
    icon: "generator",
    pages: [{ href: "/post-generator", labelKey: "nav.postGenerator", feature: "postGenerator" }],
  },
  {
    // Comments first (most replies are to comments); "/engagement" itself redirects to the first visible tab.
    href: "/engagement",
    labelKey: "nav.engagement",
    icon: "engagement",
    pages: [
      { href: "/engagement/comments", labelKey: "nav.commentReplies", descriptionKey: "nav.tabHints.commentReplies", feature: "engagement.aiReplies" },
      { href: "/engagement/messages", labelKey: "nav.dmReplies", descriptionKey: "nav.tabHints.dmReplies", feature: "engagement.aiReplies" },
      { href: "/engagement/keywords", labelKey: "nav.keywordReplies", descriptionKey: "nav.tabHints.keywordReplies", feature: "engagement.dmRules" },
      { href: "/engagement/settings", labelKey: "nav.replySettings", descriptionKey: "nav.tabHints.replySettings", feature: "engagement.aiReplies" },
    ],
  },
  {
    // From "how am I doing" to "what to do" to the deeper tools.
    href: "/post-performance",
    labelKey: "nav.insights",
    icon: "insights",
    pages: [
      { href: "/post-performance", labelKey: "nav.postPerformance", descriptionKey: "nav.tabHints.postPerformance", feature: "postInsights" },
      ...(SHOW_STATISTICS ? [{ href: "/statistics", labelKey: "nav.statistics", descriptionKey: "nav.tabHints.statistics", feature: "statistics" as const }] : []),
      { href: "/recommendations", labelKey: "nav.recommendations", descriptionKey: "nav.tabHints.recommendations", feature: "recommendations" },
      { href: "/reports", labelKey: "nav.reports", descriptionKey: "nav.tabHints.reports", feature: "reports" },
      { href: "/methods", labelKey: "nav.methods", descriptionKey: "nav.tabHints.methods", feature: "methods" },
      { href: "/post-monitoring", labelKey: "nav.postMonitoring", descriptionKey: "nav.tabHints.postMonitoring", feature: "monitoring" },
      { href: "/experiment", labelKey: "nav.experiment", descriptionKey: "nav.tabHints.experiment", feature: "experiment" },
    ],
  },
  {
    href: "/competitors",
    labelKey: "nav.competitors",
    icon: "competitors",
    pages: [
      { href: "/competitors", labelKey: "nav.competitorAccounts", feature: "competitors" },
      { href: "/competitors/analysis", labelKey: "nav.competitorAnalysis", feature: "competitors.analysis" },
    ],
  },
  { href: "/settings", labelKey: "nav.settings", icon: "settings", pages: [{ href: "/settings", labelKey: "nav.settings" }], mobile: false, placement: "bottom" },
];

export const ADMIN_NAV: NavItem[] = [
  { href: "/admin", labelKey: "nav.overview", icon: "home", mobile: true },
  { href: "/admin/clients", labelKey: "nav.clients", icon: "clients", mobile: true },
  { href: "/admin/onboarding", labelKey: "nav.onboarding", icon: "onboarding", mobile: true },
  { href: "/admin/system", labelKey: "nav.system", icon: "system", mobile: true },
];

/** Feature required to open a user route. */
export const ROUTE_FEATURES: Record<string, FeatureKey> = Object.fromEntries(
  USER_NAV.flatMap<NavPage>((item) => item.pages ?? [item])
    .filter((page) => page.feature)
    .map((page) => [page.href, page.feature!]),
);

export const HOME_BY_ROLE = {
  admin: "/admin",
  user: "/dashboard",
} as const;
