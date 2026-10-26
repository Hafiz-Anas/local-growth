import { expect, test, type Browser, type Page } from "@playwright/test";
import { Pool } from "pg";

/**
 * Weekly tips in demo mode: the app runs with the mock AI (no Gemini), which writes the tips in code
 * from the growth signals of the mock posts. Covers the new cards (at most 3, ranked by impact, the
 * action on top, a "Why" line with the owner's numbers), Mark as done, one set of tips a week, "Last week's results" (a
 * measured result after 7 days, and a plain "not enough data"), and Arabic (RTL) on a phone.
 * Run with E2E_AI_PROVIDER=mock (see playwright.config.ts); skipped otherwise. Uses the seeded
 * "Dalla & Bean" café (mock Instagram) and clears its tips first (DATABASE_URL).
 */

test.skip(process.env.E2E_AI_PROVIDER !== "mock", "Needs the app on the mock AI: E2E_AI_PROVIDER=mock.");
test.describe.configure({ mode: "serial" });

const USER = { email: "cafe@localgrowth.dev", password: "User@123" };
const DAY = 24 * 60 * 60 * 1000;
const IMPACT_ORDER = ["high", "medium", "low"];

let page: Page;
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

const tips = () => page.getByTestId("recommendation");
const results = () => page.getByTestId("results");

/** Moves a done tip (and its baseline) back in time, as if it was marked done `days` ago. */
async function age(action: string, days: number) {
  const at = new Date(Date.now() - days * DAY);
  const res = await pool.query(
    `UPDATE "Recommendation" SET "statusAt" = $3, "outcome" = NULL, "outcomeAt" = NULL, "baseline" = jsonb_set("baseline"::jsonb, '{at}', to_jsonb($4::text))
     WHERE "businessId" = $1 AND "actionEn" = $2 AND "status" = 'DONE'`,
    [businessId, action, at, at.toISOString()],
  );
  expect(res.rowCount).toBe(1);
}

async function markDone(index: number): Promise<string> {
  const card = tips().nth(index);
  const action = (await card.locator("h3").textContent())!.trim();
  const saved = page.waitForResponse((r) => /\/api\/recommendations\/[\w-]+$/.test(r.url()) && r.request().method() === "PATCH");
  await card.getByRole("button", { name: "Mark as done" }).click();
  expect((await saved).ok()).toBe(true);
  return action;
}

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) throw new Error("Set DATABASE_URL to the local e2e database.");
  pool = new Pool({ connectionString: url });
  businessId = (await pool.query(`SELECT "id" FROM "Business" WHERE "instagramHandle" = 'dallabean.kw'`)).rows[0].id;
  await pool.query(`DELETE FROM "RecommendationRun" WHERE "businessId" = $1`, [businessId]);
  page = await browser.newPage();
  await login(page, USER);
  if ((await page.locator("html").getAttribute("dir")) === "rtl") await switchLanguage(page, "en");
});

test.afterAll(async () => {
  await page.close();
  await pool.end();
});

test("demo mode: at most 3 specific tips, ranked by impact, each quoting the café's own numbers", async () => {
  await page.goto("/recommendations");
  await expect(page.getByText("No tips yet")).toBeVisible();
  const done = page.waitForResponse((r) => r.url().endsWith("/api/recommendations/refresh"));
  await page.getByRole("button", { name: "Refresh" }).click();
  expect((await done).ok()).toBe(true);

  await expect(page.getByRole("heading", { name: "This week's tips" })).toBeVisible();
  const count = await tips().count();
  expect(count).toBeGreaterThanOrEqual(1);
  expect(count).toBeLessThanOrEqual(3);

  const impacts = await tips().evaluateAll((cards) => cards.map((c) => c.getAttribute("data-impact")));
  expect(impacts.every((i) => IMPACT_ORDER.includes(i!))).toBe(true);
  // Highest expected impact first.
  expect([...impacts].sort((a, b) => IMPACT_ORDER.indexOf(a!) - IMPACT_ORDER.indexOf(b!))).toEqual(impacts);

  for (let i = 0; i < count; i++) {
    const card = tips().nth(i);
    await expect(card.getByTestId("impact")).toHaveText(/^(High|Medium|Low) impact$/);
    await expect(card.getByText(`Tip ${i + 1}`)).toBeVisible();
    // What, when and how: a product from the café's menu and a day/time (or "this week").
    await expect(card.locator("h3")).toHaveText(/(Spanish Latte|Flat White|Pistachio Latte|Ethiopian V60|Colombian Cold Brew|Saffron Cake|Date Cheesecake).*(on \w+day at \d{1,2}(am|pm)|at \d{1,2}(am|pm)|this week)/);
    // The why quotes numbers.
    await expect(card.getByTestId("why")).toHaveText(/^Why: .*\d/);
    await expect(card.getByRole("button", { name: "Mark as done" })).toBeVisible();
  }

  // Saved per business, ranked, at most 3.
  const api = (await (await page.request.get("/api/recommendations")).json()).data as { current: Array<{ impact: string; category: string }> };
  expect(api.current.length).toBe(count);
  expect(api.current.every((r) => IMPACT_ORDER.includes(r.impact))).toBe(true);
  await expect(results()).toContainText("Mark a tip as done and we'll show here what changed 7 days later.");

  // One set a week: Refresh is off and the server refuses to replace the tips.
  await expect(page.getByTestId("next-set")).toHaveText(/^New tips on /);
  await expect(page.getByRole("button", { name: "Refresh" })).toBeDisabled();
  const again = await page.request.post("/api/recommendations/refresh");
  expect(again.status()).toBe(409);
  expect((await again.json()).error.code).toBe("recommendations_week_set");
});

test("Arabic, right to left, on a phone", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await switchLanguage(page, "ar");
  try {
    await page.goto("/recommendations");
    await expect(page.getByRole("heading", { name: "التوصيات" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "نصائح هذا الأسبوع" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "نتائج الأسبوع الماضي" })).toBeVisible();
    const card = tips().first();
    await expect(card.getByTestId("impact")).toHaveText(/^تأثير (عالٍ|متوسط|منخفض)$/);
    await expect(card.getByTestId("why")).toContainText("السبب:");
    await expect(card.locator("h3")).toHaveAttribute("dir", "auto");
    await expect(card.locator("h3")).toContainText(/انشروا|اجعلوا/);
    await expect(card.getByRole("button", { name: "تم التنفيذ" })).toBeVisible();
    await expect(results()).toContainText("حدّدوا نصيحة كمنفّذة وسنعرض هنا ما تغيّر بعد ٧ أيام.");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  } finally {
    await switchLanguage(page, "en");
    await page.setViewportSize({ width: 1280, height: 800 });
  }
});

test("Mark as done moves a tip to Last week's results until its 7 days are over", async () => {
  const before = await tips().count();
  const action = await markDone(0);
  await page.reload();
  await expect(tips()).toHaveCount(before - 1);
  const row = results().getByTestId("result").filter({ hasText: action });
  await expect(row).toHaveAttribute("data-verdict", "pending");
  await expect(row.getByTestId("result-headline")).toHaveText(/^Results on /);
  await expect(row).toContainText("in the 7 days after with the 14 days before");
  // It's the business's own: the other demo business doesn't see it.
  const other = await page.context().browser()!.newPage();
  try {
    await login(other, { email: "user@mathanetbaity.dev", password: "User@123" });
    const theirs = (await (await other.request.get("/api/recommendations")).json()).data as { done: Array<{ action: { en: string } }> };
    expect(theirs.done.some((r) => r.action.en === action)).toBe(false);
  } finally {
    await other.close();
  }
});

test("after 7 days the result shows what changed; with no posts to compare it says so plainly", async () => {
  const measured = (await results().getByTestId("result-action").first().textContent())!.trim();
  await age(measured, 8);
  await page.reload();
  const row = results().getByTestId("result").filter({ hasText: measured });
  await expect(row).not.toHaveAttribute("data-verdict", "pending");
  await expect(row.getByTestId("result-headline")).toHaveText(/^((Reach|Shares|Saves|Comments|Likes \+ comments|Followers) (up|down) [\d.]+%|.+: no clear change .+|Not enough data to tell yet)$/);

  // A tip marked done long ago, with no posts in the week after: no made-up result.
  const old = await markDone(0);
  await age(old, 400);
  await page.reload();
  const thin = results().getByTestId("result").filter({ hasText: old });
  await expect(thin).toHaveAttribute("data-verdict", "not_enough_data");
  await expect(thin.getByTestId("result-headline")).toHaveText("Not enough data to tell yet");
  await expect(thin).toContainText("we can't say what changed");

  await switchLanguage(page, "ar");
  try {
    await expect(results().getByRole("heading", { name: "نتائج الأسبوع الماضي" })).toBeVisible();
    await expect(results().locator('[data-verdict="not_enough_data"]').last().getByTestId("result-headline")).toHaveText("لا توجد بيانات كافية للحكم بعد");
  } finally {
    await switchLanguage(page, "en");
  }
});
