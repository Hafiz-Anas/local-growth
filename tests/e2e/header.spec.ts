import { expect, test, type Page } from "@playwright/test";

/**
 * The client header (see playwright.config.ts for how to run): only the Instagram connection
 * status sits in it (with the notification bell and the profile menu's avatar); the plan,
 * language and dark/light switches live in the profile menu and keep working there — English
 * and Arabic, desktop and phone widths. Uses the seeded "Mathanet Baity" demo business (Pro).
 */

const USER = { email: "user@mathanetbaity.dev", password: "User@123" };

test.describe.configure({ mode: "serial" });

async function login(p: Page) {
  await p.goto("/login");
  await p.getByLabel("Email").fill(USER.email);
  await p.getByLabel("Password", { exact: true }).fill(USER.password);
  await p.getByRole("button", { name: "Log in" }).click();
  await p.waitForURL((url) => !url.pathname.startsWith("/login"));
}

const header = (p: Page) => p.locator("header").filter({ has: p.getByTestId("profile-menu-trigger") });
const openMenu = async (p: Page) => {
  await p.getByTestId("profile-menu-trigger").click();
  await expect(p.getByRole("menu")).toBeVisible();
};

test("the header shows only the Instagram connection; plan, language and theme are in the menu", async ({ page }) => {
  await login(page);
  if ((await page.locator("html").getAttribute("dir")) === "rtl") {
    await openMenu(page);
    await page.getByTestId("menu-language").click();
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  }
  await page.goto("/dashboard");
  const h = header(page);
  await expect(h).toContainText("Connected");
  await expect(h.getByText("Pro", { exact: true })).toHaveCount(0);
  await expect(h.getByRole("button", { name: "Change language" })).toHaveCount(0);
  await expect(h.getByRole("button", { name: /Switch to (light|dark) mode/ })).toHaveCount(0);
  await expect(page.getByTestId("notification-bell")).toBeVisible();

  await openMenu(page);
  const menu = page.getByRole("menu");
  await expect(menu).toContainText("Business account");
  await expect(menu.getByText("Pro", { exact: true })).toBeVisible();
  // Phone-only shortcuts stay hidden on desktop.
  await expect(menu.getByRole("menuitem", { name: "Reports" })).toBeHidden();
  await page.keyboard.press("Escape");
});

test("dark/light switch works from the menu and survives a reload", async ({ page }) => {
  await login(page);
  await page.goto("/dashboard");
  const wasDark = await page.locator("html").evaluate((el) => el.classList.contains("dark"));
  const saved = page.waitForResponse((r) => r.url().includes("/api/me/preferences") && r.request().method() === "PATCH");
  await openMenu(page);
  await page.getByTestId("menu-theme").click();
  await expect.poll(() => page.locator("html").evaluate((el) => el.classList.contains("dark"))).toBe(!wasDark);
  await saved;
  await page.reload();
  expect(await page.locator("html").evaluate((el) => el.classList.contains("dark"))).toBe(!wasDark);
  // And back.
  await openMenu(page);
  await page.getByTestId("menu-theme").click();
  await page.waitForResponse((r) => r.url().includes("/api/me/preferences") && r.request().method() === "PATCH");
  await page.reload();
  expect(await page.locator("html").evaluate((el) => el.classList.contains("dark"))).toBe(wasDark);
});

test("language switch works from the menu (Arabic, right to left) and survives a reload", async ({ page }) => {
  await login(page);
  await page.goto("/dashboard");
  const saved = page.waitForResponse((r) => r.url().includes("/api/me/preferences") && r.request().method() === "PATCH");
  await openMenu(page);
  await page.getByTestId("menu-language").click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await saved;
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(header(page)).toContainText("متصل");
  await openMenu(page);
  await expect(page.getByTestId("menu-language")).toContainText("English");
  await page.getByTestId("menu-language").click();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await page.waitForResponse((r) => r.url().includes("/api/me/preferences") && r.request().method() === "PATCH");
});

test("phone width: the connection status fits; Settings is in the menu, the sections in the tab bar", async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await login(page);
  await page.goto("/dashboard");
  await expect(header(page)).toContainText("Connected");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
  await openMenu(page);
  await expect(page.getByRole("menu").getByText("Pro", { exact: true })).toBeVisible();
  // All five sections fit the tab bar, so the menu has no page shortcuts — and no "Profile" that only led back home.
  await expect(page.getByTestId("menu-shortcut")).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Profile" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await page.waitForURL(/\/settings$/);
  await page.getByTestId("tab-bar").getByRole("link", { name: "Insights" }).click();
  await page.waitForURL(/\/recommendations$/);
  await page.close();
});
