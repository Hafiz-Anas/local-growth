import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * The dashboard's AI status card (see playwright.config.ts for how to run): account, coverage,
 * freshness and links, links that follow the client's modules, Arabic (RTL) and phone width.
 * Reads stored data only (no AI calls). Uses the seeded "Mathanet Baity" demo business.
 */

const USER = { email: "user@mathanetbaity.dev", password: "User@123" };
const ADMIN = { email: "admin@localgrowth.dev", password: "Admin@123" };

test.describe.configure({ mode: "serial" });

let page: Page;

async function login(p: Page, account: { email: string; password: string }) {
  await p.goto("/login");
  await p.getByLabel("Email").fill(account.email);
  await p.getByLabel("Password", { exact: true }).fill(account.password);
  await p.getByRole("button", { name: "Log in" }).click();
  await p.waitForURL((url) => !url.pathname.startsWith("/login"));
}

async function switchLanguage(p: Page, to: "en" | "ar") {
  const saved = p.waitForResponse((r) => r.url().includes("/api/me/preferences") && r.request().method() === "PATCH");
  // Language lives in the profile menu (the header only shows the Instagram connection).
  await p.getByTestId("profile-menu-trigger").click();
  await p.getByTestId("menu-language").click();
  await expect(p.locator("html")).toHaveAttribute("dir", to === "ar" ? "rtl" : "ltr");
  await saved;
}

const card = (p: Page) => p.getByTestId("ai-status");

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await browser.newPage();
  await login(page, USER);
  if ((await page.locator("html").getAttribute("dir")) === "rtl") await switchLanguage(page, "en");
});

test.afterAll(async () => {
  await page.close();
});

test("shows the account, coverage, freshness and links to the AI modules", async () => {
  await page.goto("/dashboard");
  await expect(card(page).getByRole("heading", { name: "AI status" })).toBeVisible();
  await expect(card(page)).toContainText("Demo data");
  await expect(card(page)).toContainText("@mathanet_baity");
  await expect(card(page)).toContainText(/\d+ recent posts analysed/);
  await expect(card(page)).toContainText(/\d+ competitors tracked/);
  await expect(card(page)).toContainText("Data synced: demo data, no sync");
  await expect(card(page)).toContainText("Last AI analysis: not yet");
  // Demo data needs no reconnect: no warning.
  await expect(card(page).getByRole("alert")).toHaveCount(0);
  // Opens the assistant panel.
  await card(page).getByRole("button", { name: "AI Assistant" }).click();
  await expect(page.getByTestId("assistant-panel")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(card(page).getByRole("link", { name: "Recommendations" })).toBeVisible();
});

test("links follow the client's modules, and the card goes when no AI module is on", async ({ browser }) => {
  const adminPage = await browser.newPage();
  await login(adminPage, ADMIN);
  const list = await adminPage.request.get("/api/admin/businesses?q=mathanet_baity");
  const [business] = (await list.json()).data as Array<{ id: string }>;
  const set = (changes: Record<string, boolean>) => adminPage.request.patch(`/api/admin/businesses/${business.id}/permissions`, { data: { changes } });
  try {
    expect((await set({ recommendations: false })).ok()).toBe(true);
    await page.goto("/dashboard");
    await expect(card(page).getByRole("button", { name: "AI Assistant" })).toBeVisible();
    await expect(card(page).getByRole("link", { name: "Recommendations" })).toHaveCount(0);
    await expect(card(page)).not.toContainText("Last AI analysis");

    expect((await set({ competitors: false })).ok()).toBe(true);
    await page.goto("/dashboard");
    await expect(card(page)).not.toContainText("competitors tracked");

    expect((await set({ assistant: false })).ok()).toBe(true);
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(card(page)).toHaveCount(0);
    expect((await page.request.get("/api/dashboard/ai-status")).status()).toBe(404);
  } finally {
    await set({ recommendations: true, competitors: true, assistant: true });
    await adminPage.close();
  }
});

test("Arabic, right to left, and phone width", async () => {
  await page.goto("/dashboard");
  await switchLanguage(page, "ar");
  await expect(card(page).getByRole("heading", { name: "حالة الذكاء الاصطناعي" })).toBeVisible();
  await expect(card(page)).toContainText("بيانات تجريبية");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  await expect(card(page)).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
  await switchLanguage(page, "en");
});
