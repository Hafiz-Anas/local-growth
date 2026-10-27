import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * Client navigation (config/navigation.ts), end to end: the five sections in the Instagram sidebar
 * (Gallery, Engagement, AI, Insights, Competitors; Settings, the collapse button and the profile row
 * with Log out at the bottom; the collapsed state survives a reload),
 * Insights with its pages as tabs, the old Home and Posts URLs landing on the Gallery, the phone tab
 * bar (icons with accessible labels, active section, no footer banner), Arabic RTL, and
 * per-client feature switches removing pages and sections everywhere.
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

const SECTIONS = ["Gallery", "Engagement", "AI", "Insights", "Competitors"];

const sidebar = (p: Page) => p.getByTestId("sidebar");
// The sections list (the first one); Settings and the collapse button are in the list at the bottom.
const sidebarLabels = (p: Page) => sidebar(p).locator("nav > ul").first().getByRole("link").allInnerTexts();
const collapseButton = (p: Page) => sidebar(p).getByRole("button", { name: /^(Collapse|Expand|طي القائمة|توسيع القائمة)$/ });
const tabBar = (p: Page) => p.getByTestId("tab-bar");
// The phone tab bar shows icons only; each tab is named by its aria-label.
const tabBarLabels = (p: Page) => tabBar(p).getByRole("link").evaluateAll((links) => links.map((l) => l.getAttribute("aria-label")));
const sectionTabs = (p: Page) => p.getByTestId("section-tabs");
const tabLabels = (p: Page) => sectionTabs(p).getByTestId("section-tab-label");

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
  await page.goto("/gallery");
  await page.waitForLoadState("networkidle");
  expect((await sidebarLabels(page)).map((l) => l.trim())).toEqual(SECTIONS);
  // The AI section is the one with the Instagram gradient.
  await expect(sidebar(page).getByRole("link", { name: "AI", exact: true }).locator(".bg-ig-gradient")).toHaveCount(1);
  await expect(sidebar(page).locator(".bg-ig-gradient")).toHaveCount(1);
  // At the bottom, as before the port: Settings, the collapse button and the profile row (with Log out).
  const bottom = sidebar(page).locator("nav > ul").last();
  await expect(bottom.getByRole("link", { name: "Settings" })).toBeVisible();
  await expect(bottom.getByRole("button", { name: "Collapse" })).toBeVisible();
  await sidebar(page).getByTestId("sidebar-profile").click();
  await expect(page.getByRole("menu").getByTestId("menu-logout")).toContainText("Log out");
  await page.keyboard.press("Escape");
  await expect(sidebar(page).getByRole("link", { name: "Gallery" })).toHaveAttribute("aria-current", "page");
  // No section tabs on single-page sections.
  await expect(sectionTabs(page)).toHaveCount(0);

  // From "how am I doing" to "what to do" to the deeper tools, each tab with a line under its title.
  await sidebar(page).getByRole("link", { name: "Insights" }).click();
  await expect(page).toHaveURL(/\/post-performance$/);
  await expect(tabLabels(page)).toHaveText(["Post performance", "Recommendations", "Weekly reports", "Marketing methods", "Post monitoring", "Best posting times"]);
  await expect(sectionTabs(page).getByRole("link", { name: "Post performance" })).toHaveAttribute("aria-current", "page");
  await expect(sectionTabs(page).getByRole("link", { name: "Recommendations" })).toHaveAccessibleDescription("What to do next");
  await expect(sectionTabs(page)).toContainText("When to post");

  await sectionTabs(page).getByRole("link", { name: "Weekly reports" }).click();
  await expect(page).toHaveURL(/\/reports$/);
  await expect(sectionTabs(page).getByRole("link", { name: "Weekly reports" })).toHaveAttribute("aria-current", "page");
  // The sidebar keeps Insights active on every page of the section.
  await expect(sidebar(page).getByRole("link", { name: "Insights" })).toHaveAttribute("aria-current", "page");

  await sectionTabs(page).getByRole("link", { name: "Best posting times" }).click();
  await expect(page).toHaveURL(/\/experiment$/);
  await expect(page).toHaveTitle("Best posting times · AI Growth Engine");
  await expect(sidebar(page).getByRole("link", { name: "Insights" })).toHaveAttribute("aria-current", "page");

  // Statistics is turned off (config/insights.ts): old links land on Post performance, never a 404.
  await page.goto("/statistics");
  await expect(page).toHaveURL(/\/post-performance$/);
  await expect(page.getByTestId("what-works")).toBeVisible();

  await sidebar(page).getByRole("link", { name: "AI", exact: true }).click();
  await expect(page).toHaveURL(/\/ai$/);
  await expect(sidebar(page).getByRole("link", { name: "AI", exact: true })).toHaveAttribute("aria-current", "page");

  // Home and Posts are gone: their old links land on the Gallery (Home keeps the query string).
  const home = await page.goto("/dashboard?switched=1");
  expect(new URL(home!.url()).pathname + new URL(home!.url()).search).toBe("/gallery?switched=1");
  await page.goto("/post-generator");
  await expect(page).toHaveURL(/\/gallery$/);
  await expect(sidebar(page).getByRole("link", { name: "Gallery" })).toHaveAttribute("aria-current", "page");
});

test("desktop: the sidebar collapses to icons and expands again; the choice survives a reload, also in Arabic", async () => {
  await page.goto("/gallery");
  await page.waitForLoadState("networkidle");
  const width = async () => (await sidebar(page).boundingBox())!.width;
  expect(await width()).toBe(244);
  await collapseButton(page).click();
  await expect(page.locator("html")).toHaveAttribute("data-sidebar", "collapsed");
  await expect.poll(width).toBe(72);
  // The labels fade out; the sections, Settings and the profile row stay as icons.
  await expect(sidebar(page).getByRole("link", { name: "Engagement" }).getByText("Engagement")).toHaveCSS("opacity", "0");
  await expect(sidebar(page).getByTestId("sidebar-profile")).toBeVisible();
  // The main column follows the sidebar.
  expect((await page.locator("main").boundingBox())!.x).toBeLessThan(400);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-sidebar", "collapsed");
  expect(await width()).toBe(72);
  await expect(collapseButton(page)).toHaveAccessibleName("Expand");

  // Arabic: the sidebar sits on the right, with the same button and the saved state.
  await switchLanguage(page, "ar");
  await expect.poll(async () => (await sidebar(page).boundingBox())!.x).toBeGreaterThan(1000);
  await collapseButton(page).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-sidebar", "collapsed");
  await expect.poll(width).toBe(244);
  await expect(sidebar(page).getByRole("link", { name: "الإعدادات" })).toBeVisible();
  await switchLanguage(page, "en");
  await page.reload();
  expect(await width()).toBe(244);
});

// Between 1024 and 1279px the sidebar is the icon rail, as before the port; the tab bar takes over below 1024px.
test("tablet widths: icon rail from 1024px, the tab bar below", async () => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto("/gallery");
  await expect.poll(async () => (await sidebar(page).boundingBox())!.width).toBe(72);
  await expect(tabBar(page)).toBeHidden();
  await expect(collapseButton(page)).toBeHidden();
  await page.setViewportSize({ width: 900, height: 800 });
  await expect(sidebar(page)).toBeHidden();
  await expect(tabBar(page)).toBeVisible();
  await page.setViewportSize({ width: 1366, height: 800 });
});

test("phone: five icon tabs with accessible labels, active section, no footer banner", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/gallery");
  await page.waitForLoadState("networkidle");
  await expect(sidebar(page)).toBeHidden();
  expect(await tabBarLabels(page)).toEqual(SECTIONS);
  // Icons only: no visible text in the tab bar.
  expect((await tabBar(page).innerText()).trim()).toBe("");
  await expect(tabBar(page).getByRole("link", { name: "Gallery" })).toHaveAttribute("aria-current", "page");

  await tabBar(page).getByRole("link", { name: "Insights" }).click();
  await expect(page).toHaveURL(/\/post-performance$/);
  await sectionTabs(page).getByRole("link", { name: "Weekly reports" }).click();
  await expect(page).toHaveURL(/\/reports$/);
  await expect(tabBar(page).getByRole("link", { name: "Insights" })).toHaveAttribute("aria-current", "page");

  // No footer banner: the AI tab is the only way into the chat.
  await expect(page.getByTestId("ai-banner")).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("Arabic, right to left: the sections and tabs are translated", async () => {
  await switchLanguage(page, "ar");
  await expect.poll(() => tabBarLabels(page)).toEqual(["المعرض", "التفاعل", "الذكاء الاصطناعي", "الإحصاءات", "المنافسون"]);
  await expect(tabLabels(page)).toHaveText(["أداء المنشورات", "التوصيات", "التقارير الأسبوعية", "أساليب التسويق", "مراقبة المنشورات", "أفضل أوقات النشر"]);
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
    await page.goto("/gallery");
    await page.waitForLoadState("networkidle");
    await expect(sidebar(page).getByRole("link", { name: "Insights" })).toHaveAttribute("href", "/experiment");
    await page.goto("/experiment");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(sectionTabs(page)).toHaveCount(0);
    expect((await page.request.get("/reports")).status()).toBe(404);

    // Nothing left: Insights (and Competitors) are gone from the sidebar and the phone tab bar.
    expect((await set({ experiment: false, competitors: false })).ok()).toBe(true);
    await page.goto("/gallery");
    await page.waitForLoadState("networkidle");
    expect((await sidebarLabels(page)).map((l) => l.trim())).toEqual(["Gallery", "Engagement", "AI"]);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await tabBarLabels(page)).toEqual(["Gallery", "Engagement", "AI"]);
    await page.setViewportSize({ width: 1366, height: 800 });

    // Gallery and AI are modules too: off, their sections go, /ai is a 404, and the
    // landing page (also the old /dashboard) is the first section left.
    expect((await set({ gallery: false, aiChat: false })).ok()).toBe(true);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/engagement\/comments$/);
    await page.waitForLoadState("networkidle");
    expect((await sidebarLabels(page)).map((l) => l.trim())).toEqual(["Engagement"]);
    expect((await page.request.get("/ai")).status()).toBe(404);
  } finally {
    await set({ recommendations: true, reports: true, statistics: true, postInsights: true, monitoring: true, methods: true, experiment: true, competitors: true, gallery: true, aiChat: true });
    await adminPage.close();
    await page.setViewportSize({ width: 1366, height: 800 });
  }
  await page.reload();
  expect((await sidebarLabels(page)).map((l) => l.trim())).toEqual(SECTIONS);
});
