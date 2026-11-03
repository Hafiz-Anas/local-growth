import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { Pool } from "pg";
import type { InsightsOverviewDto } from "../../types";

/**
 * Insights → Overview (UX3): the first, default tab of Insights. Three key numbers for the last 7 days
 * vs the 7 before (from the API, so the page shows exactly what the code computed, with its period and
 * the posts it rests on), this week's tips with Mark as done / Not for me (two tips are written straight
 * into the database for this, then removed), a summary in plain words with the sample size, and an honest
 * "Not enough data yet" for an account that isn't connected (the seeded Noor Boutique) — no numbers, no
 * sample data. Also on a phone in Arabic. Uses the seeded "Mathanet Baity" (mock Instagram) and needs
 * DATABASE_URL (local e2e database). Screenshots go to E2E_SHOTS_DIR (default test-results/overview-shots).
 */

const USER = { email: "user@mathanetbaity.dev", password: "User@123" };
const BOUTIQUE = { email: "boutique@localgrowth.dev", password: "User@123" };
const SHOTS = process.env.E2E_SHOTS_DIR ?? "test-results/overview-shots";
const RUN_HASH = "e2e-insights-overview";

test.describe.configure({ mode: "serial", timeout: 120_000 });

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

async function language(p: Page, dir: "rtl" | "ltr") {
  if ((await p.locator("html").getAttribute("dir")) === dir) return;
  const saved = p.waitForResponse((r) => r.url().includes("/api/me/preferences") && r.request().method() === "PATCH");
  await p.getByTestId("profile-menu-trigger").filter({ visible: true }).click();
  await p.getByTestId("menu-language").click();
  await expect(p.locator("html")).toHaveAttribute("dir", dir);
  await saved;
}

const overview = (p = page) => p.getByTestId("insights-overview");
const metrics = (p = page) => overview(p).getByTestId("overview-metric");
const tips = () => overview().getByTestId("overview-actions").getByTestId("recommendation");
/** The API's answer; once more if next dev drops the kept-alive connection (ECONNRESET on Windows). */
async function readOverview(p: Page): Promise<InsightsOverviewDto> {
  const get = async () => ((await (await p.request.get("/api/insights/overview")).json()).data as InsightsOverviewDto);
  try {
    return await get();
  } catch (error) {
    if (!/ECONNRESET|socket hang up/.test(String(error))) throw error;
    return get();
  }
}
const fmt = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(n);

async function clearTestTips() {
  await pool.query(`DELETE FROM "RecommendationRun" WHERE "businessId" = $1 AND "inputHash" = $2`, [businessId, RUN_HASH]);
}

/** A fresh analysis with two new tips (newest run, so they're "this week's tips"). */
async function addTips() {
  await clearTestTips();
  const run = `e2e_run_${Date.now()}`;
  await pool.query(`INSERT INTO "RecommendationRun" ("id", "businessId", "trigger", "inputHash", "createdAt") VALUES ($1, $2, 'MANUAL', $3, now())`, [run, businessId, RUN_HASH]);
  const tip = (rank: number, en: string, ar: string) =>
    pool.query(
      `INSERT INTO "Recommendation" ("id", "businessId", "runId", "actionEn", "actionAr", "rationaleEn", "rationaleAr", "category", "metric", "impact", "rank", "confidence", "basedOnPosts")
       VALUES ($1, $2, $3, $4, $5, 'Your Reels reached more people.', 'وصلت الريلز إلى أشخاص أكثر.', 'format', 'reach', 'high', $6, 'MODERATE', 8)`,
      [`${run}_${rank}`, businessId, run, en, ar, rank],
    );
  await tip(0, "Post a Reel of the Majboos on Thursday evening", "انشر ريل للمجبوس مساء الخميس");
  await tip(1, "Ask a question in your next caption", "اطرح سؤالًا في تعليقك القادم");
}

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  // Cold next dev compiles each route on its first request.
  test.setTimeout(240_000);
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) throw new Error("Set DATABASE_URL to the local e2e database.");
  pool = new Pool({ connectionString: url });
  businessId = (await pool.query(`SELECT "id" FROM "Business" WHERE "instagramHandle" = 'mathanet_baity'`)).rows[0].id;
  page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  await login(page, USER);
  await language(page, "ltr");
  // next dev answers the first request to a route it hasn't compiled with an HTML 404.
  for (const route of ["/api/insights/overview", "/insights", "/post-performance", "/reports", "/recommendations"]) await page.request.get(route);
});

test.afterAll(async () => {
  await clearTestTips();
  await page.close();
  await pool.end();
});

test("Insights opens on Overview, its first tab; the other tabs are unchanged", async () => {
  await page.goto("/gallery", { waitUntil: "networkidle" });
  await page.getByTestId("sidebar").getByRole("link", { name: "Insights" }).click();
  await expect(page).toHaveURL(/\/insights$/);
  const tabs = page.getByTestId("section-tabs");
  await expect(tabs.getByTestId("section-tab-label")).toHaveText(["Overview", "Post performance", "Recommendations", "Weekly reports", "Marketing methods", "Post monitoring", "Best posting times"]);
  await expect(tabs.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
  await expect(overview().getByRole("heading", { level: 1 })).toHaveText("Overview");
  await expect(page).toHaveTitle("Insights · AI Growth Engine");
});

test("three key numbers for the last 7 days vs the 7 before, each with its change, period and sample size", async () => {
  const api = await readOverview(page);
  expect(api.connected).toBe(true);
  expect(api.metrics).toHaveLength(3);
  await page.goto("/insights");
  await expect(metrics()).toHaveCount(3);
  await expect(overview().getByTestId("overview-period")).toContainText(" vs ");
  // A demo business: its numbers are the sample data, and say so.
  await expect(overview().getByText("Demo data")).toBeVisible();

  for (const [i, m] of api.metrics.entries()) {
    const card = metrics().nth(i);
    await expect(card).toHaveAttribute("data-metric", m.key);
    await expect(card).toHaveAttribute("data-state", m.state);
    if (m.state === "not_enough") {
      await expect(card.getByTestId("metric-not-enough")).toHaveText("Not enough data yet");
      await expect(card.getByTestId("metric-value")).toHaveCount(0);
      continue;
    }
    const value = m.key === "newFollowers" ? `${m.current! > 0 ? "+" : m.current! < 0 ? "−" : ""}${fmt(Math.abs(m.current!))}` : fmt(m.current!);
    await expect(card.getByTestId("metric-value")).toHaveText(value);
    if (m.changePct !== null) await expect(card).toContainText(`${fmt(Math.abs(m.changePct))}%`);
    await expect(card.getByTestId("metric-compare")).toHaveText(m.state === "ok" ? /^vs .+ the 7 days before$/ : "Too little data to compare (needs at least 3 posts each week).");
    await expect(card.getByTestId("metric-based-on")).toHaveText(m.key === "newFollowers" ? "From your daily follower counts" : `From ${m.posts.current} posts`);
    // See details goes to the tab with the details.
    await expect(card.getByTestId("see-details")).toHaveAttribute("href", m.key === "newFollowers" ? "/reports" : "/post-performance");
  }
  await page.screenshot({ path: path.join(SHOTS, "desktop.png"), fullPage: true });

  await metrics().first().getByTestId("see-details").click();
  await expect(page).toHaveURL(api.metrics[0].key === "newFollowers" ? /\/reports$/ : /\/post-performance$/);
});

test("a weekly summary in plain words, built from the numbers, with the sample size", async () => {
  const api = await readOverview(page);
  expect(api.summary).not.toBeNull();
  const s = api.summary!;
  await page.goto("/insights");
  const summary = overview().getByTestId("overview-summary");
  const text = summary.getByTestId("summary-text");
  if (s.lead.kind === "change") await expect(text).toContainText(s.lead.direction === "flat" ? "about the same as the 7 days before" : `${s.lead.direction} ${fmt(s.lead.pct)}% compared with the 7 days before`);
  else if (s.lead.kind === "followers") await expect(text).toContainText(/You (gained|lost) \d+ followers|didn't change/);
  else await expect(text).toContainText(`You posted ${s.lead.current} times`);
  if (s.best) await expect(text).toContainText(`Over the last 14 days, ${{ reel: "Reels", photo: "photos", carousel: "carousels", video: "videos" }[s.best.format]} did best: ${fmt(s.best.avgInteractions)} likes and comments per post on average (${s.best.posts} posts)`);
  await expect(summary.getByTestId("summary-based-on")).toHaveText(`Based on ${s.posts.current + s.posts.previous} posts: ${s.posts.current} in the last 7 days and ${s.posts.previous} the 7 days before.`);
  await summary.getByTestId("see-details").click();
  await expect(page).toHaveURL(/\/reports$/);
});

test("this week's tips from Recommendations, with Mark as done and Not for me; a clear message once none are left", async () => {
  await addTips();
  await page.goto("/insights");
  const actions = overview().getByTestId("overview-actions");
  await expect(tips()).toHaveCount(2);
  await expect(tips().first()).toContainText("Post a Reel of the Majboos on Thursday evening");
  await expect(tips().first()).toContainText("Why: Your Reels reached more people.");
  await page.screenshot({ path: path.join(SHOTS, "desktop-tips.png"), fullPage: true });

  const decided = () => page.waitForResponse((r) => /\/api\/recommendations\/[\w-]+$/.test(r.url()) && r.request().method() === "PATCH");
  let saved = decided();
  await tips().nth(1).getByRole("button", { name: "Not for me" }).click();
  expect((await saved).ok()).toBe(true);
  await expect(tips()).toHaveCount(1);
  saved = decided();
  await tips().first().getByRole("button", { name: "Mark as done" }).click();
  expect((await saved).ok()).toBe(true);
  await expect(tips()).toHaveCount(0);
  await expect(actions.getByTestId("overview-no-tips")).toHaveText("You've worked through this week's tips. New ones come with the next weekly check.");

  // The same decisions on the Recommendations tab.
  await actions.getByTestId("see-details").click();
  await expect(page).toHaveURL(/\/recommendations$/);
  await expect(page.getByTestId("results").getByTestId("result-action")).toContainText(["Post a Reel of the Majboos on Thursday evening"]);
});

test("not connected: \"Not enough data yet\" everywhere, no numbers and no sample data", async ({ browser }) => {
  const other = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  try {
    await login(other, BOUTIQUE);
    await language(other, "ltr");
    await other.goto("/insights");
    await expect(overview(other).getByTestId("overview-not-connected")).toContainText("Connect Instagram to see how you're doing");
    await expect(metrics(other)).toHaveCount(3);
    for (const card of await metrics(other).all()) {
      await expect(card).toHaveAttribute("data-state", "not_enough");
      await expect(card.getByTestId("metric-not-enough")).toHaveText("Not enough data yet");
    }
    await expect(overview(other).getByTestId("metric-value")).toHaveCount(0);
    await expect(overview(other).getByTestId("summary-not-enough")).toContainText("Not enough data yet");
    await expect(overview(other).getByText("Demo data")).toHaveCount(0);
    const api = await readOverview(other);
    expect(api.connected).toBe(false);
    expect(api.summary).toBeNull();
    expect(api.metrics.every((m) => m.current === null)).toBe(true);
    await other.screenshot({ path: path.join(SHOTS, "desktop-not-connected.png"), fullPage: true });
  } finally {
    await other.close();
  }
});

test("on a phone, in Arabic, right to left", async ({ browser }) => {
  await addTips();
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  try {
    await login(phone, USER);
    await phone.goto("/insights");
    await language(phone, "rtl");
    await expect(overview(phone).getByRole("heading", { level: 1 })).toHaveText("نظرة عامة");
    await expect(phone.getByTestId("section-tabs").getByRole("link", { name: "نظرة عامة" })).toHaveAttribute("aria-current", "page");
    await expect(metrics(phone)).toHaveCount(3);
    await expect(overview(phone).getByTestId("overview-actions").getByTestId("recommendation").first()).toContainText("انشر ريل للمجبوس مساء الخميس");
    await expect(overview(phone).getByTestId("summary-based-on")).toContainText("مبني على");
    // One column on a phone, nothing wider than the screen.
    const [a, b] = await Promise.all([metrics(phone).nth(0).boundingBox(), metrics(phone).nth(1).boundingBox()]);
    expect(b!.y).toBeGreaterThan(a!.y + a!.height - 1);
    expect(await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await phone.screenshot({ path: path.join(SHOTS, "phone-arabic.png"), fullPage: true });
    await phone.setViewportSize({ width: 1366, height: 900 });
    await phone.screenshot({ path: path.join(SHOTS, "desktop-arabic.png"), fullPage: true });
  } finally {
    await language(phone, "ltr");
    await phone.close();
    await clearTestTips();
  }
});
