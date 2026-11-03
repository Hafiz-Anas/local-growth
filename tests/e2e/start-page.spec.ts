import path from "node:path";
import { Pool } from "pg";
import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * Settings → Preferences → "Start page" (UX1), for the seeded "Dalla & Bean" login: Gallery by default; picking
 * another section is saved per user (User.uiPreferences) and logging in, "/" and old /dashboard links land there;
 * only the sections the business has are offered, and when the chosen one is switched off later the login falls
 * back to the Gallery. Not shown in admin preview. Arabic on a phone, dark mode. Screenshots: E2E_SHOTS_DIR.
 */

const USER = { email: "cafe@localgrowth.dev", password: "User@123" };
const ADMIN = { email: "admin@localgrowth.dev", password: "Admin@123" };
const SHOTS = process.env.E2E_SHOTS_DIR ?? "test-results/start-page-shots";

test.describe.configure({ mode: "serial", timeout: 120_000 });

let pool: Pool;
let businessId: string;

async function login(p: Page, account = USER) {
  await p.goto("/login");
  await p.getByLabel("Email").fill(account.email);
  await p.getByLabel("Password", { exact: true }).fill(account.password);
  await p.getByRole("button", { name: /^(Log in|تسجيل الدخول)$/ }).click();
  await p.waitForURL((url) => !url.pathname.startsWith("/login"));
}
const setPrefs = (prefs: Record<string, unknown>) =>
  pool.query(`UPDATE "User" SET "uiPreferences" = COALESCE("uiPreferences", '{}'::jsonb) || $2::jsonb WHERE email = $1`, [USER.email, JSON.stringify(prefs)]);
const startPageSelect = (p: Page) => p.getByTestId("start-page");

test.beforeAll(async () => {
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) throw new Error("Set DATABASE_URL to the local e2e database.");
  pool = new Pool({ connectionString: url.replace(/\?.*$/, "") });
  businessId = (await pool.query(`SELECT "businessId" FROM "User" WHERE email = $1`, [USER.email])).rows[0].businessId;
  await setPrefs({ startPage: "gallery", language: "en", theme: "light" });
});

test.afterAll(async () => {
  await setPrefs({ startPage: "gallery", language: "en", theme: "light" });
  await pool.end();
});

test("Gallery by default; pick Insights and the next login lands there (also \"/\" and old /dashboard links)", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  await login(page);
  await expect(page).toHaveURL(/\/gallery$/);
  await page.goto("/settings");
  const select = startPageSelect(page);
  await expect(select).toHaveValue("gallery");
  await expect(select.locator("option")).toHaveText(["Gallery", "Engagement", "AI", "Insights", "Competitors"]);
  await expect(page.getByText("Where the app opens after you log in")).toBeVisible();

  const saved = page.waitForResponse((r) => r.url().includes("/api/me/preferences") && r.request().method() === "PATCH");
  await select.selectOption("insights");
  expect((await saved).ok()).toBe(true);
  await expect(page.getByText("Start page saved")).toBeVisible();
  expect((await pool.query(`SELECT "uiPreferences"->>'startPage' AS s FROM "User" WHERE email = $1`, [USER.email])).rows[0].s).toBe("insights");
  await select.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, "desktop-settings.png") });

  // Still chosen after a reload; "/" and old /dashboard links go there too (the query is kept).
  await page.reload();
  await expect(startPageSelect(page)).toHaveValue("insights");
  // "/" goes through the start page (the proxy's redirect, read without following it: on this machine the redirect's
  // host can be AUTH_URL's port).
  const root = await page.request.get("/", { maxRedirects: 0 });
  expect(new URL(root.headers().location ?? "", "http://x").pathname).toBe("/dashboard");
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/insights$/);
  await page.goto("/dashboard?switched=1");
  await expect(page).toHaveURL(/\/insights\?switched=1$/);
  await context.close();

  // A new login (another browser) lands on Insights.
  const fresh = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const p2 = await fresh.newPage();
  await login(p2);
  await expect(p2).toHaveURL(/\/insights$/);
  await fresh.close();
});

test("only the sections the business has are offered; a section switched off later falls back to the Gallery", async ({ browser }) => {
  await setPrefs({ startPage: "competitors" });
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await login(admin, ADMIN);
  const set = (value: boolean) => admin.request.patch(`/api/admin/businesses/${businessId}/permissions`, { data: { changes: { competitors: value } } });
  try {
    expect((await set(false)).ok()).toBe(true);
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const page = await context.newPage();
    await login(page);
    await expect(page).toHaveURL(/\/gallery$/);
    await page.goto("/settings");
    await expect(startPageSelect(page).locator("option")).toHaveText(["Gallery", "Engagement", "AI", "Insights"]);
    // The section it was set to is gone: the Gallery is where it opens now, and that's what shows.
    await expect(startPageSelect(page)).toHaveValue("gallery");
    await context.close();
  } finally {
    expect((await set(true)).ok()).toBe(true);
  }
  // Switched back on: the saved choice applies again.
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  await login(page);
  await expect(page).toHaveURL(/\/competitors$/);
  await context.close();

  // Admin preview: not this login's setting, so not shown.
  await admin.goto(`/admin/clients/${businessId}`);
  await admin.getByRole("button", { name: /Preview as this client/ }).click();
  await admin.waitForURL((u) => !u.pathname.startsWith("/admin"));
  await admin.goto("/settings");
  await expect(admin.getByText("Language & appearance")).toBeVisible();
  await expect(startPageSelect(admin)).toHaveCount(0);
  await adminContext.close();
});

test("Arabic on a phone, and dark mode", async ({ browser }: { browser: Browser }) => {
  await setPrefs({ startPage: "ai", language: "ar", theme: "dark" });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  try {
    await login(page);
    await expect(page).toHaveURL(/\/ai$/);
    await page.goto("/settings");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveClass(/dark/);
    const select = startPageSelect(page);
    await expect(select).toHaveValue("ai");
    await expect(page.getByText("صفحة البداية", { exact: true })).toBeVisible();
    await expect(select.locator("option")).toHaveText(["المعرض", "التفاعل", "الذكاء الاصطناعي", "الإحصاءات", "المنافسون"]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await select.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, "phone-arabic-dark-settings.png") });
  } finally {
    await context.close();
  }
});
