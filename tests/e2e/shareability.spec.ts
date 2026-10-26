import { expect, test, type Browser, type Page } from "@playwright/test";
import { Pool } from "pg";
import { startGeminiStub } from "./gemini-stub";

/**
 * "Most shared" on Post performance (feature postInsights.shareability), end to end in mock mode
 * (see playwright.config.ts for how to run): the posts with the highest share rate (shares ÷ reach) vs
 * the account's average, the findings (Gemini stub: cached once a day, invented numbers rejected,
 * numbers still shown when the AI is down), a post's share rate on its detail page, the weekly
 * Recommendations' data, Arabic on a phone, the admin preview and the feature switch. Uses the seeded
 * "Mathanet Baity" business (mock Instagram). Clears its cached findings first (DATABASE_URL).
 */

const USER = { email: "user@mathanetbaity.dev", password: "User@123" };
const ADMIN = { email: "admin@localgrowth.dev", password: "Admin@123" };

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
const clearFindings = () => pool.query(`DELETE FROM "ShareFindings" WHERE "businessId" = $1`, [businessId]);
const card = () => page.getByTestId("most-shared");
const pctOf = (text: string) => Number(text.replace("%", ""));

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) throw new Error("Set DATABASE_URL to the local e2e database.");
  pool = new Pool({ connectionString: url });
  stub = await startGeminiStub();
  businessId = await asAdmin(browser, async (_admin, id) => id);
  await clearFindings();
  page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  await login(page, USER);
  if ((await page.locator("html").getAttribute("dir")) === "rtl") await switchLanguage(page, "en");
});

test.afterAll(async () => {
  await page.close();
  await stub.close();
  await pool.end();
});

test("Most shared: the top posts by share rate, each against the account's average, and the findings", async () => {
  await page.goto("/post-performance");
  await expect(card()).toContainText("Most shared");
  await expect(card()).toContainText(/Your average: [\d.]+% over \d+ posts/);
  const rows = card().getByTestId("most-shared-post");
  await expect(rows).toHaveCount(3);
  // Highest share rate first, each with "N× your average".
  const rates = (await card().getByTestId("most-shared-rate").allInnerTexts()).map(pctOf);
  expect(rates).toEqual([...rates].sort((a, b) => b - a));
  await expect(card().getByTestId("most-shared-times").first()).toHaveText(/^[\d.]+× your average$/);
  await expect(rows.first()).toContainText(/\d+ shares · reach [\d,]+/);

  // The findings load after the numbers (Gemini stub), quoting the average from the data.
  const average = (await card().innerText()).match(/Your average: ([\d.]+)%/)![1];
  await expect(card().getByTestId("share-findings")).toContainText(`above your average of ${average}%`);
  await expect(card().getByTestId("ai-explanation")).toContainText("AI · estimate");
  const block = calls("shareability").at(-1)!.system;
  expect(block).toContain("Posts reached by fewer than 100 accounts are left out");
  expect(block).toContain("Most-shared posts:");
  expect(block).toContain("Least-shared posts:");
  expect(block).toContain("By post type:");
});

test("the findings are cached: a reload doesn't ask the AI again", async () => {
  const before = calls("shareability").length;
  await page.reload();
  await expect(card().getByTestId("share-findings")).toBeVisible();
  expect(calls("shareability").length).toBe(before);
  // Even asked directly, they're rewritten at most once a day.
  const res = await page.request.post("/api/shareability/findings");
  expect((await res.json()).data.status).toBe("ready");
  expect(calls("shareability").length).toBe(before);
});

test("a post's detail page shows its share rate against the average", async () => {
  await page.goto("/post-performance");
  const first = card().getByTestId("most-shared-post").first();
  const rate = await card().getByTestId("most-shared-rate").first().innerText();
  await first.click();
  await expect(page).toHaveURL(/\/post-performance\/.+/);
  const box = page.getByTestId("post-share-rate");
  await expect(box.getByTestId("post-share-rate-value")).toHaveText(rate);
  await expect(box).toContainText("of the people it reached shared it");
  await expect(box).toContainText(/Your average is [\d.]+% \(\d+ posts\)/);
});

test("invented numbers are rejected, and with the AI down the numbers still show", async () => {
  await clearFindings();
  stub.state.inventShares = true;
  try {
    await page.goto("/post-performance");
    await expect(card().getByTestId("ai-explanation-unavailable")).toBeVisible();
    await expect(card().getByTestId("most-shared-post")).toHaveCount(3);
    expect((await pool.query(`SELECT jsonb_array_length("findings") AS n, "failedAt" FROM "ShareFindings" WHERE "businessId" = $1`, [businessId])).rows[0]).toMatchObject({ n: 0 });
  } finally {
    stub.state.inventShares = false;
  }
  await clearFindings();
  stub.state.fail = true;
  try {
    await page.goto("/post-performance");
    await expect(card().getByTestId("ai-explanation-unavailable")).toBeVisible();
    await expect(card().getByTestId("most-shared-post")).toHaveCount(3);
  } finally {
    stub.state.fail = false;
  }
  await clearFindings();
});

test("the weekly Recommendations get the share numbers and findings", async () => {
  await page.goto("/post-performance");
  await expect(card().getByTestId("share-findings")).toBeVisible();
  // A fresh analysis: earlier specs may have used today's refreshes or left the same input.
  await pool.query(`DELETE FROM "RecommendationRun" WHERE "businessId" = $1`, [businessId]);
  const res = await page.request.post("/api/recommendations/refresh");
  expect(res.ok()).toBe(true);
  const system = calls("strategy").at(-1)!.system;
  expect(system).toContain("## Shareability");
  expect(system).toMatch(/Account average: [\d.]+%/);
  expect(system).toContain("Findings (written from these numbers):");
  expect(system).toContain("## Growth signals");
  expect(system).toContain("Instagram rewards posts people send to friends (shares)");
});

test("Arabic, right to left, on a phone", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await switchLanguage(page, "ar");
  try {
    await page.goto("/post-performance");
    await expect(card()).toContainText("الأكثر مشاركة");
    await expect(card().getByTestId("most-shared-times").first()).toHaveText(/× متوسطكم$/);
    await expect(card().getByTestId("share-findings")).toContainText("السحوبات");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  } finally {
    await switchLanguage(page, "en");
    await page.setViewportSize({ width: 1366, height: 900 });
  }
});

test("feature switch: off removes the card, the detail's share rate and the API; the admin preview has it when on", async ({ browser }) => {
  await asAdmin(browser, async (admin, id) => {
    const preview = (await (await admin.request.get(`/api/admin/preview/${id}`)).json()).data;
    expect(preview.data.shareability.mostShared).toHaveLength(3);
    for (const p of preview.data.shareability.mostShared as Array<{ id: string }>) expect(preview.data.postDetails[p.id].shareRate.status).toBe("ok");
  });
  const set = (enabled: boolean) =>
    asAdmin(browser, async (admin, id) => expect((await admin.request.patch(`/api/admin/businesses/${id}/permissions`, { data: { changes: { "postInsights.shareability": enabled } } })).ok()).toBe(true));
  await set(false);
  try {
    await page.goto("/post-performance");
    await expect(page.getByTestId("recent-chart")).toBeVisible();
    await expect(card()).toHaveCount(0);
    expect((await page.request.get("/api/shareability")).status()).toBe(404);
    expect((await page.request.post("/api/shareability/findings")).status()).toBe(404);
    await page.getByTestId("recent-post").first().click();
    await expect(page.getByTestId("post-metrics")).toBeVisible();
    await expect(page.getByTestId("post-share-rate")).toHaveCount(0);
  } finally {
    await set(true);
  }
});
