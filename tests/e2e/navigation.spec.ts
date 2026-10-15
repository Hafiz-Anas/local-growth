import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * Client navigation (config/navigation.ts), end to end: six sections in the sidebar, Insights with
 * its pages as tabs, the phone tab bar (labels, active section, clear of the assistant banner),
 * Arabic RTL, and per-client feature switches removing pages and sections everywhere.
 * Uses the seeded "Mathanet Baity" demo business (Pro: every module on).
 */

const USER = { email: "user@mathanetbaity.dev", password: "User@123" };
const ADMIN = { email: "admin@localgrowth.dev", password: "Admin@123" };

test.describe.configure({ mode: "serial" });

async function login(p: Page, account: { email: string; password: string }) {
  await p.goto("/login");
  await p.getByLabel("Email").fill(account.email);
  await p.getByLabel("Password", { exact: true }).fill(account.password);
  await p.getByRole("button", { name: "Log in" }).click();
  await p.waitForURL((url) => !url.pathname.startsWith("/login"));
}

async function switchLanguage(p: Page, to: "en" | "ar") {
  const saved = p.waitForResponse((r) => r.url().includes("/api/me/preferences") && r.request().method() === "PATCH");
  await p.getByTestId("profile-menu-trigger").click();
  await p.getByTestId("menu-language").click();
  await expect(p.locator("html")).toHaveAttribute("dir", to === "ar" ? "rtl" : "ltr");
  await saved;
}

const sidebar = (p: Page) => p.locator("aside");
const sidebarLabels = (p: Page) => sidebar(p).locator("nav, ul").first().getByRole("link").allInnerTexts();
const tabBar = (p: Page) => p.getByTestId("tab-bar");
const sectionTabs = (p: Page) => p.getByTestId("section-tabs");

let page: Page;

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await browser.newPage({ viewport: { width: 1366, height: 800 } });
  await login(page, USER);
  if ((await page.locator("html").getAttribute("dir")) === "rtl") await switchLanguage(page, "en");
});

test.afterAll(async () => {
  await page.close();
});

test("desktop: one sidebar entry per section; Insights holds its pages as tabs", async () => {
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");
  expect((await sidebarLabels(page)).map((l) => l.trim())).toEqual(["Home", "Posts", "Engagement", "Insights", "Competitors", "Settings"]);
  // No section tabs on single-page sections.
  await expect(sectionTabs(page)).toHaveCount(0);

  await sidebar(page).getByRole("link", { name: "Insights" }).click();
  await expect(page).toHaveURL(/\/recommendations$/);
  await expect(sectionTabs(page).getByRole("link")).toHaveText(["Recommendations", "Reports", "Statistics", "Post performance", "Post monitoring", "Methods", "Posting experiment"]);
  await expect(sectionTabs(page).getByRole("link", { name: "Recommendations" })).toHaveAttribute("aria-current", "page");

  await sectionTabs(page).getByRole("link", { name: "Reports" }).click();
  await expect(page).toHaveURL(/\/reports$/);
  await expect(sectionTabs(page).getByRole("link", { name: "Reports" })).toHaveAttribute("aria-current", "page");
  // The sidebar keeps Insights active on every page of the section.
  await expect(sidebar(page).getByRole("link", { name: "Insights" })).toHaveAttribute("aria-current", "page");

  await sectionTabs(page).getByRole("link", { name: "Posting experiment" }).click();
  await expect(page).toHaveURL(/\/experiment$/);
  await expect(sidebar(page).getByRole("link", { name: "Insights" })).toHaveAttribute("aria-current", "page");

  await sidebar(page).getByRole("link", { name: "Posts" }).click();
  await expect(page).toHaveURL(/\/post-generator$/);
  await expect(sidebar(page).getByRole("link", { name: "Posts" })).toHaveAttribute("aria-current", "page");
});

test("phone: five labelled tabs, active section, nothing behind the assistant banner", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");
  await expect(tabBar(page).getByRole("link")).toHaveText(["Home", "Posts", "Engagement", "Insights", "Competitors"]);
  await expect(tabBar(page).getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");

  await tabBar(page).getByRole("link", { name: "Insights" }).click();
  await expect(page).toHaveURL(/\/recommendations$/);
  await sectionTabs(page).getByRole("link", { name: "Reports" }).click();
  await expect(page).toHaveURL(/\/reports$/);
  await expect(tabBar(page).getByRole("link", { name: "Insights" })).toHaveAttribute("aria-current", "page");

  // The assistant banner sits right above the tab bar, never on top of it.
  const bar = (await tabBar(page).boundingBox())!;
  const banner = (await page.getByTestId("assistant-banner").boundingBox())!;
  expect(banner.y + banner.height).toBeLessThanOrEqual(bar.y + 1);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("Arabic, right to left: the sections and tabs are translated", async () => {
  await switchLanguage(page, "ar");
  await expect(tabBar(page).getByRole("link")).toHaveText(["الرئيسية", "المنشورات", "التفاعل", "التحليلات", "المنافسون"]);
  await expect(sectionTabs(page).getByRole("link")).toHaveText(["التوصيات", "التقارير", "الإحصاءات", "أداء المنشورات", "مراقبة المنشورات", "الأساليب", "تجربة النشر"]);
  await switchLanguage(page, "en");
  await page.setViewportSize({ width: 1366, height: 800 });
});

test("feature switches: hidden pages and sections disappear everywhere (not grayed out)", async ({ browser }) => {
  const adminPage = await browser.newPage();
  await login(adminPage, ADMIN);
  const list = await adminPage.request.get("/api/admin/businesses?q=mathanet_baity");
  const [business] = (await list.json()).data as Array<{ id: string }>;
  const set = (changes: Record<string, boolean>) => adminPage.request.patch(`/api/admin/businesses/${business.id}/permissions`, { data: { changes } });

  try {
    // Only the posting experiment left in Insights: the section links straight to it, without tabs.
    expect((await set({ recommendations: false, reports: false, statistics: false, postInsights: false, monitoring: false, methods: false })).ok()).toBe(true);
    await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");
    await expect(sidebar(page).getByRole("link", { name: "Insights" })).toHaveAttribute("href", "/experiment");
    await page.goto("/experiment");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(sectionTabs(page)).toHaveCount(0);
    expect((await page.request.get("/reports")).status()).toBe(404);

    // Nothing left: Insights is gone from the sidebar and the phone tab bar.
    expect((await set({ experiment: false, competitors: false })).ok()).toBe(true);
    await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");
    expect((await sidebarLabels(page)).map((l) => l.trim())).toEqual(["Home", "Posts", "Engagement", "Settings"]);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(tabBar(page).getByRole("link")).toHaveText(["Home", "Posts", "Engagement"]);
  } finally {
    await set({ recommendations: true, reports: true, statistics: true, postInsights: true, monitoring: true, methods: true, experiment: true, competitors: true });
    await adminPage.close();
    await page.setViewportSize({ width: 1366, height: 800 });
  }
  await page.reload();
  expect((await sidebarLabels(page)).map((l) => l.trim())).toEqual(["Home", "Posts", "Engagement", "Insights", "Competitors", "Settings"]);
});
