import { expect, test, type Browser, type Page } from "@playwright/test";
import { Pool } from "pg";
import { startGeminiStub } from "./gemini-stub";

/**
 * The Statistics page, end to end (see playwright.config.ts for how to run): numbers and charts per
 * range, from when data is available, the AI summary (cached, invented numbers rejected, numbers and
 * charts only when the AI is down), the daily follower count, the assistant's data, navigation,
 * Arabic RTL on a phone and the feature switch. Uses the seeded "Mathanet Baity" business (Pro, mock
 * Instagram) and the Gemini stub. Clears the business's cached summaries first (DATABASE_URL), so it
 * doesn't need a fresh seed.
 */

const USER = { email: "user@mathanetbaity.dev", password: "User@123" };
const ADMIN = { email: "admin@localgrowth.dev", password: "Admin@123" };
const CRON_SECRET = process.env.CRON_SECRET ?? "e2e-cron";

test.describe.configure({ mode: "serial" });

let page: Page;
let stub: Awaited<ReturnType<typeof startGeminiStub>>;
let pool: Pool;
let businessId: string;

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

async function asAdmin<T>(browser: Browser, work: (admin: Page, id: string) => Promise<T>): Promise<T> {
  const admin = await browser.newPage();
  try {
    await login(admin, ADMIN);
    const [business] = (await (await admin.request.get("/api/admin/businesses?q=mathanet_baity")).json()).data as Array<{ id: string }>;
    return await work(admin, business.id);
  } finally {
    await admin.close();
  }
}

const calls = (kind: string) => stub.calls.filter((c) => c.kind === kind);
const range = (name: string) => page.getByRole("radio", { name, exact: true });

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) throw new Error("Set DATABASE_URL to the local e2e database.");
  pool = new Pool({ connectionString: url });
  stub = await startGeminiStub();
  businessId = await asAdmin(browser, async (_admin, id) => id);
  await pool.query(`DELETE FROM "StatisticsSummary" WHERE "businessId" = $1`, [businessId]);
  page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  await login(page, USER);
  if ((await page.locator("html").getAttribute("dir")) === "rtl") await switchLanguage(page, "en");
});

test.afterAll(async () => {
  await page.close();
  await stub.close();
  await pool.end();
});

test("statistics: numbers, charts and an AI summary of the last 30 days", async () => {
  await page.goto("/statistics");
  await expect(page.getByRole("heading", { name: "Statistics" })).toBeVisible();
  await expect(page.getByTestId("section-tabs").getByRole("link", { name: "Statistics" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("radiogroup").getByRole("radio")).toHaveText(["7 days", "30 days", "90 days", "1 year"]);
  await expect(range("30 days")).toHaveAttribute("aria-checked", "true");

  await expect(page.getByTestId("stat-availability")).toContainText(/Data available from \w{3} \d{1,2}, \d{4}\./);
  await expect(page.getByTestId("stat-availability")).toContainText("longer trends build up from what we store every day");
  const tiles = page.getByTestId("stat-tiles");
  for (const stat of ["followers", "postsPerWeek", "avgReach", "engagement"]) await expect(tiles.locator(`[data-stat="${stat}"]`)).toBeVisible();
  await expect(tiles.locator('[data-stat="engagement"]')).toContainText("%");
  await expect(page.getByTestId("stat-posts-count")).toContainText(/Posts in this period: \d+/);
  await expect(page.getByTestId("chart-followers")).toBeVisible();
  await expect(page.getByTestId("chart-activity")).toBeVisible();
  await expect(page.getByTestId("chart-reach")).toBeVisible();
  await expect(page.getByTestId("chart-engagement")).toBeVisible();
  await expect(page.getByTestId("best-days").locator("li").first()).toBeVisible();
  await expect(page.getByTestId("best-times").locator("li").first()).toBeVisible();
  await expect(page.getByTestId("content-mix")).toContainText("Reel");

  await expect(page.getByTestId("ai-explanation-text")).toContainText("Posting more often went together with more likes");
  const system = calls("statistics").at(-1)!.system;
  expect(system).toContain("<statistics_data>");
  expect(system).toContain("Period: the last 30 days");
  expect(system).toContain("demo data");
  expect(system).toContain("never as causes");

  // Cached: opening the page again doesn't ask the AI again.
  const before = calls("statistics").length;
  await page.reload();
  await expect(page.getByTestId("ai-explanation-text")).toBeVisible();
  expect(calls("statistics").length).toBe(before);
});

test("ranges: 7 days, 90 days and 1 year, with what the data covers", async () => {
  await page.goto("/statistics");
  await range("1 year").click();
  await expect(range("1 year")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("stat-availability")).toContainText("This period starts earlier, so the numbers cover only part of it.");
  const year = (await (await page.request.get("/api/statistics?range=1y")).json()).data;
  expect(year.bucket).toBe("month");
  expect(year.series.length).toBe(13);
  expect(year.availability.complete).toBe(false);
  await range("90 days").click();
  await expect(page.getByTestId("chart-activity")).toBeVisible();
  expect((await (await page.request.get("/api/statistics?range=90d")).json()).data.bucket).toBe("week");
  await range("7 days").click();
  await expect(range("7 days")).toHaveAttribute("aria-checked", "true");
  const week = (await (await page.request.get("/api/statistics?range=7d")).json()).data;
  expect(week.series.length).toBe(7);
  expect((await page.request.get("/api/statistics?range=2y")).status()).toBe(400);
});

test("an AI summary with invented numbers is rejected; with the AI down the numbers and charts still show", async () => {
  await pool.query(`DELETE FROM "StatisticsSummary" WHERE "businessId" = $1`, [businessId]);
  stub.state.inventStatistics = true;
  try {
    const res = await page.request.post("/api/statistics/summary?range=30d");
    expect((await res.json()).data).toMatchObject({ status: "unavailable", text: null });
  } finally {
    stub.state.inventStatistics = false;
  }
  stub.state.fail = true;
  try {
    await page.goto("/statistics");
    await expect(page.getByTestId("ai-explanation-unavailable")).toBeVisible();
    await expect(page.getByTestId("stat-tiles")).toBeVisible();
    await expect(page.getByTestId("chart-activity")).toBeVisible();
  } finally {
    stub.state.fail = false;
  }
});

test("the daily job stores one follower count a day", async ({ request }) => {
  expect((await request.get("/api/cron/statistics")).status()).toBe(401);
  const today = new Date().toISOString().slice(0, 10);
  await pool.query(`DELETE FROM "InstagramAccountSnapshot" WHERE "businessId" = $1 AND date = $2`, [businessId, today]);
  const run = async () => (await (await request.get("/api/cron/statistics", { headers: { authorization: `Bearer ${CRON_SECRET}` } })).json()).data as { snapshots: number };
  expect((await run()).snapshots).toBeGreaterThanOrEqual(1);
  const rows = await pool.query(`SELECT followers FROM "InstagramAccountSnapshot" WHERE "businessId" = $1 AND date = $2`, [businessId, today]);
  expect(rows.rowCount).toBe(1);
  expect(rows.rows[0].followers).toBeGreaterThan(0);
  // Already counted today: left alone.
  const again = await pool.query(`SELECT count(*) FROM "InstagramAccountSnapshot" WHERE "businessId" = $1`, [businessId]);
  await run();
  expect((await pool.query(`SELECT count(*) FROM "InstagramAccountSnapshot" WHERE "businessId" = $1`, [businessId])).rows[0].count).toBe(again.rows[0].count);
  const stats = (await (await page.request.get("/api/statistics?range=7d")).json()).data;
  expect(stats.series.at(-1).followers).toBe(rows.rows[0].followers);
});

test("the assistant's Analytics mode gets the statistics", async () => {
  const res = await page.request.post("/api/assistant/messages", { data: { mode: "analytics", text: "How did my account do this month?" } });
  expect(res.status()).toBe(201);
  const system = calls("chat").at(-1)!.system;
  expect(system).toContain("## Statistics: the last 30 days vs the 30 before");
  expect(system).toContain("This period:");
});

test("Arabic, right to left, on a phone", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await switchLanguage(page, "ar");
  try {
    await page.goto("/statistics");
    await expect(page.getByRole("heading", { name: "الإحصاءات" })).toBeVisible();
    await expect(page.getByRole("radiogroup").getByRole("radio")).toHaveText(["7 أيام", "30 يوماً", "90 يوماً", "سنة"]);
    await expect(page.getByTestId("stat-availability")).toContainText("البيانات متاحة منذ");
    await expect(page.getByTestId("ai-explanation-text")).toContainText("ترافق النشر الأكثر");
    await page.waitForLoadState("networkidle");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  } finally {
    await switchLanguage(page, "en");
    await page.setViewportSize({ width: 1366, height: 900 });
  }
});

test("feature switch: Statistics off is gone from the navigation and answers 404; the admin preview has it when on", async ({ browser }) => {
  await asAdmin(browser, async (admin, id) => {
    const preview = (await (await admin.request.get(`/api/admin/preview/${id}`)).json()).data;
    expect(Object.keys(preview.data.statistics).sort()).toEqual(["1y", "30d", "7d", "90d"]);
  });
  const set = (enabled: boolean) =>
    asAdmin(browser, async (admin, id) => expect((await admin.request.patch(`/api/admin/businesses/${id}/permissions`, { data: { changes: { statistics: enabled } } })).ok()).toBe(true));
  await set(false);
  try {
    await page.goto("/recommendations");
    await expect(page.getByTestId("section-tabs").getByRole("link", { name: "Statistics" })).toHaveCount(0);
    expect((await page.request.get("/api/statistics")).status()).toBe(404);
    expect((await page.request.get("/statistics")).status()).toBe(404);
    const res = await page.request.post("/api/assistant/messages", { data: { mode: "analytics", text: "Any numbers?" } });
    expect(res.status()).toBe(201);
    expect(calls("chat").at(-1)!.system).not.toContain("## Statistics");
  } finally {
    await set(true);
  }
});
