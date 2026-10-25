import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { FEATURE_KEYS } from "../config/features";
import { SHOW_STATISTICS } from "../config/insights";
import { MAX_PHONE_TABS, ROUTE_FEATURES, USER_NAV, type NavItem, type NavPage } from "../config/navigation";
import { PLAN_IDS, PLAN_PRESETS } from "../config/plans";
import { activePage, activeSection, isActiveItem, splitForPhone } from "../lib/navigation";
import { allOff, filterNav } from "../lib/permissions";
import type { FeatureKey, Permissions } from "../types";

const allOn = () => Object.fromEntries(FEATURE_KEYS.map((k) => [k, true])) as Permissions;
const without = (...keys: FeatureKey[]) => ({ ...allOn(), ...Object.fromEntries(keys.map((k) => [k, false])) }) as Permissions;
const labels = (nav: NavItem[]) => nav.map((i) => i.labelKey);
const section = (nav: NavItem[], key: string) => nav.find((i) => i.labelKey === key);

describe("navigation config: one obvious home per page", () => {
  it("has six sections in order, Settings pinned to the bottom", () => {
    assert.deepEqual(labels(filterNav(USER_NAV, allOn())), ["nav.home", "nav.posts", "nav.engagement", "nav.insights", "nav.competitors", "nav.settings"]);
    assert.deepEqual(
      USER_NAV.filter((i) => i.placement === "bottom").map((i) => i.href),
      ["/settings"],
    );
  });

  it("lists every page exactly once (no duplicates), and each has a route (no dead ends)", () => {
    const pages = USER_NAV.flatMap<NavPage>((i) => i.pages ?? [i]).map((p) => p.href);
    assert.equal(new Set(pages).size, pages.length);
    for (const href of pages) assert.ok(existsSync(path.join("app", "(user)", href, "page.tsx")), `no page for ${href}`);
  });

  it("has every label in English and Arabic", () => {
    const get = (locale: string, key: string) => key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], JSON.parse(readFileSync(path.join("locales", `${locale}.json`), "utf8")));
    const pages = USER_NAV.flatMap((i) => i.pages ?? []);
    const keys = [...USER_NAV.map((i) => i.labelKey), ...pages.map((p) => p.labelKey), ...pages.flatMap((p) => (p.descriptionKey ? [p.descriptionKey] : [])), "nav.main"];
    for (const key of keys) for (const locale of ["en", "ar"]) assert.equal(typeof get(locale, key), "string", `${locale}: ${key}`);
  });

  it("orders Insights from \"how am I doing\" to \"what to do\" to the deeper tools, each tab with a description", () => {
    const insights = section(filterNav(USER_NAV, allOn()), "nav.insights")!;
    assert.equal(insights.href, "/post-performance");
    assert.deepEqual(insights.pages!.map((p) => p.href), ["/post-performance", "/recommendations", "/reports", "/methods", "/post-monitoring", "/experiment"]);
    for (const page of insights.pages!) assert.ok(page.descriptionKey, `no description for ${page.href}`);
    assert.deepEqual(section(filterNav(USER_NAV, allOn()), "nav.competitors")!.pages!.map((p) => p.href), ["/competitors", "/competitors/analysis"]);
    assert.equal(ROUTE_FEATURES["/competitors/analysis"], "competitors.analysis");
    assert.equal(ROUTE_FEATURES["/reports"], "reports");
    assert.equal(ROUTE_FEATURES["/experiment"], "experiment");
  });
});

describe("Statistics tab switch (config/insights.ts)", () => {
  it("keeps Statistics out of the navigation while it is turned off", () => {
    const hrefs = USER_NAV.flatMap((i) => i.pages ?? []).map((p) => p.href);
    assert.equal(hrefs.includes("/statistics"), SHOW_STATISTICS);
    assert.equal("/statistics" in ROUTE_FEATURES, SHOW_STATISTICS);
  });
});

describe("feature switches: hidden modules appear nowhere", () => {
  it("removes a hidden page from its section, and the section links to the first visible page", () => {
    const insights = section(filterNav(USER_NAV, without("postInsights")), "nav.insights")!;
    assert.equal(insights.href, "/recommendations");
    assert.deepEqual(insights.pages!.map((p) => p.href), ["/recommendations", "/reports", "/methods", "/post-monitoring", "/experiment"]);
    // competitors.analysis off: Competitors keeps one page (no tabs).
    assert.deepEqual(section(filterNav(USER_NAV, without("competitors.analysis")), "nav.competitors")!.pages!.map((p) => p.href), ["/competitors"]);
  });

  it("removes a section whose pages are all hidden", () => {
    const nav = filterNav(USER_NAV, without("recommendations", "reports", "statistics", "postInsights", "monitoring", "methods", "experiment", "competitors"));
    assert.deepEqual(labels(nav), ["nav.home", "nav.posts", "nav.engagement", "nav.settings"]);
    const { tabs, more } = splitForPhone(nav);
    assert.deepEqual(labels(tabs), ["nav.home", "nav.posts", "nav.engagement"]);
    assert.deepEqual(more, []);
  });

  it("with everything off only Home and Settings are left", () => {
    assert.deepEqual(labels(filterNav(USER_NAV, allOff())), ["nav.home", "nav.settings"]);
  });

  it("matches each plan preset", () => {
    for (const plan of PLAN_IDS) {
      const nav = filterNav(USER_NAV, PLAN_PRESETS[plan]);
      for (const item of nav) for (const page of item.pages ?? []) assert.ok(!page.feature || PLAN_PRESETS[plan][page.feature], `${plan}: ${page.href}`);
    }
  });
});

describe("phone: tab bar and profile menu", () => {
  it("puts the five main sections in the tab bar; Settings stays in the profile menu", () => {
    const { tabs, more } = splitForPhone(filterNav(USER_NAV, allOn()));
    assert.equal(tabs.length, MAX_PHONE_TABS);
    assert.deepEqual(labels(tabs), ["nav.home", "nav.posts", "nav.engagement", "nav.insights", "nav.competitors"]);
    assert.deepEqual(more, []);
  });

  it("a future section beyond five goes to the profile menu, added with one entry", () => {
    const statistics: NavItem = { href: "/statistics", labelKey: "nav.statistics", icon: "insights", pages: [{ href: "/statistics", labelKey: "nav.statistics" }] };
    const nav = filterNav([...USER_NAV.slice(0, -1), statistics, USER_NAV.at(-1)!], allOn());
    const { tabs, more } = splitForPhone(nav);
    assert.equal(tabs.length, 5);
    assert.deepEqual(labels(more), ["nav.statistics"]);
  });
});

describe("active section", () => {
  const nav = filterNav(USER_NAV, allOn());
  it("follows the page, including sub-pages and section pages", () => {
    assert.equal(activeSection(nav, "/reports", "/dashboard")?.labelKey, "nav.insights");
    assert.equal(activeSection(nav, "/experiment", "/dashboard")?.labelKey, "nav.insights");
    assert.equal(activeSection(nav, "/competitors/abc", "/dashboard")?.labelKey, "nav.competitors");
    assert.equal(activeSection(nav, "/dashboard", "/dashboard")?.labelKey, "nav.home");
    assert.equal(activeSection(nav, "/assistant", "/dashboard"), null);
  });

  it("picks the most specific page of a section", () => {
    const competitors = section(nav, "nav.competitors")!;
    assert.equal(activePage(competitors, "/competitors/analysis")?.href, "/competitors/analysis");
    assert.equal(activePage(competitors, "/competitors/abc")?.href, "/competitors");
  });

  it("matches Home exactly", () => {
    assert.equal(isActiveItem("/dashboard/x", section(nav, "nav.home")!, "/dashboard"), false);
  });
});
