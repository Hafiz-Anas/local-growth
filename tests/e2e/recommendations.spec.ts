import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { Pool } from "pg";
import { startGeminiStub } from "./gemini-stub";

/**
 * Weekly tips with the AI, end to end (see playwright.config.ts for how to run): the first analysis
 * (the growth signals in the prompt, the model's tips ranked by impact and cut to 3, a tip with an
 * invented number dropped), one set of tips a week (Refresh locked until 7 days later — the tests
 * move the analyses back a week in the database to get past it), the "unchanged" cache, Mark as
 * done / Not for me with "Last week's results", past decisions fed into the next analysis, "AI
 * unavailable" without changing anything, Arabic (RTL), the weekly cron and the admin feature toggle.
 * The app must run with AI_PROVIDER=gemini, GEMINI_API_BASE at the Gemini stub and CRON_SECRET
 * (default "e2e-cron").
 * Uses the seeded "Mathanet Baity" demo business; clears every business's tips first (DATABASE_URL).
 * The demo mode (mock AI) has its own spec: recommendations-mock.spec.ts.
 */

test.skip(process.env.E2E_AI_PROVIDER === "mock", "Needs the Gemini stub (the default e2e AI provider).");

const USER = { email: "user@mathanetbaity.dev", password: "User@123" };
const ADMIN = { email: "admin@localgrowth.dev", password: "Admin@123" };
const CRON_SECRET = process.env.CRON_SECRET ?? "e2e-cron";
const IMPACT_ORDER = ["high", "medium", "low"];

test.describe.configure({ mode: "serial" });

let stub: Awaited<ReturnType<typeof startGeminiStub>>;
let page: Page;
let pool: Pool;

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

const tips = (p: Page): Locator => p.getByTestId("recommendation");
const card = (p: Page, action: string): Locator => tips(p).filter({ has: p.locator("h3", { hasText: action }) });
const strategyCalls = () => stub.calls.filter((c) => c.kind === "strategy").length;

/** Clicks a decision button on a card and waits until it's saved. */
async function decide(p: Page, action: string, button: string) {
  const saved = p.waitForResponse((r) => /\/api\/recommendations\/[\w-]+$/.test(r.url()) && r.request().method() === "PATCH");
  await card(p, action).getByRole("button", { name: button }).click();
  expect((await saved).ok()).toBe(true);
}

/** Opens the collapsed "Not for me" list (a <details>; clicking its summary would toggle it). */
async function openDismissed(p: Page) {
  await p.locator("details").filter({ hasText: "Not for me (" }).evaluate((d) => ((d as HTMLDetailsElement).open = true));
}

async function refresh(p: Page) {
  const done = p.waitForResponse((r) => r.url().endsWith("/api/recommendations/refresh"));
  await p.getByRole("button", { name: "Refresh" }).click();
  return done;
}

/** Moves Mathanet's analyses back 8 days, as if this week's tips were from last week (Refresh opens again). */
async function nextWeek() {
  await pool.query(
    `UPDATE "RecommendationRun" SET "createdAt" = "createdAt" - interval '8 days'
     WHERE "businessId" = (SELECT "id" FROM "Business" WHERE "instagramHandle" = 'mathanet_baity')`,
  );
  await page.reload();
  await expect(page.getByRole("button", { name: "Refresh" })).toBeEnabled();
}

const actions = async (p: Page) => (await tips(p).locator("h3").allTextContents()).map((t) => t.trim());

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) throw new Error("Set DATABASE_URL to the local e2e database.");
  pool = new Pool({ connectionString: url });
  // Every business starts without tips, so the first analysis and the weekly cron are due.
  await pool.query(`DELETE FROM "RecommendationRun"`);
  stub = await startGeminiStub();
  page = await browser.newPage();
  await login(page, USER);
  if ((await page.locator("html").getAttribute("dir")) === "rtl") await switchLanguage(page, "en");
});

test.afterAll(async () => {
  await page.close();
  await stub.close();
  await pool.end();
});

let first: string[] = [];

test("first analysis: at most 3 tips ranked by impact, each with a Why line; invented numbers are dropped", async () => {
  // Insights opens on Post performance; Recommendations is its second tab.
  await page.goto("/dashboard", { waitUntil: "networkidle" });
  await page.locator("aside").getByRole("link", { name: "Insights" }).click();
  await page.waitForURL(/\/post-performance$/);
  await page.getByTestId("section-tabs").getByRole("link", { name: "Recommendations" }).click();
  await expect(page).toHaveURL(/\/recommendations$/);
  await expect(page.getByText("No tips yet")).toBeVisible();

  await refresh(page);
  await expect(page.getByRole("heading", { name: "This week's tips" })).toBeVisible();
  const call = stub.calls.findLast((c) => c.kind === "strategy")!;
  const signals = [...call.system.matchAll(/^\[(s\d+)\] /gm)].length;
  expect(signals).toBeGreaterThan(0);
  // The stub answers one tip per signal, weakest first, plus an invented one: the app ranks and keeps 3.
  await expect(tips(page)).toHaveCount(Math.min(3, signals));
  first = await actions(page);
  expect(first.every((a) => /^Tip .+ \(#A\)$/.test(a))).toBe(true);
  await expect(page.getByText("Invented tip")).toHaveCount(0);
  const impacts = await tips(page).evaluateAll((cards) => cards.map((c) => c.getAttribute("data-impact")!));
  expect([...impacts].sort((a, b) => IMPACT_ORDER.indexOf(a) - IMPACT_ORDER.indexOf(b))).toEqual(impacts);
  await expect(tips(page).first().getByTestId("why")).toHaveText(/^Why: Your numbers: .*\d/);
  await expect(tips(page).first().getByTestId("impact")).toHaveText(/impact$/);
  // One set a week: Refresh is off until 7 days after this analysis.
  await expect(page.getByTestId("next-set")).toHaveText(/^New tips on /);
  await expect(page.getByRole("button", { name: "Refresh" })).toBeDisabled();

  expect(call.system).toContain("<business_data>");
  expect(call.system).toContain("## Growth signals");
  expect(call.system).toContain("Best time to post");
  expect(call.system).toContain("By weekday");
  expect(call.system).toContain("<past_decisions>\nNone yet.");
});

test("this week's tips can't be replaced by a manual refresh", async () => {
  const before = strategyCalls();
  const res = await page.request.post("/api/recommendations/refresh");
  expect(res.status()).toBe(409);
  const error = (await res.json()).error as { code: string; details: Array<{ path: string; message: string }> };
  expect(error.code).toBe("recommendations_week_set");
  expect(new Date(error.details.find((d) => d.path === "nextSetAt")!.message).getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);
  expect(strategyCalls()).toBe(before);
  await page.reload();
  await expect(tips(page)).toHaveCount(first.length);
  expect(await actions(page)).toEqual(first);
});

test("a week later, unchanged data isn't re-analysed", async () => {
  await nextWeek();
  const before = strategyCalls();
  await refresh(page);
  await expect(page.getByTestId("recommendations-notice")).toContainText("Nothing has changed since the last check");
  expect(strategyCalls()).toBe(before);
  // An unchanged check doesn't start a new week: Refresh stays open.
  await expect(page.getByRole("button", { name: "Refresh" })).toBeEnabled();
});

test("Mark as done and Not for me are saved; done tips wait 7 days in Last week's results", async () => {
  test.skip(first.length < 2, "Needs two tips.");
  await decide(page, first[0], "Mark as done");
  await decide(page, first[1], "Not for me");

  await page.reload();
  await expect(card(page, first[0])).toHaveCount(0);
  const result = page.getByTestId("results").getByTestId("result").filter({ hasText: first[0] });
  await expect(result).toHaveAttribute("data-verdict", "pending");
  await expect(result.getByTestId("result-headline")).toHaveText(/^Results on /);
  await openDismissed(page);
  await expect(card(page, first[1])).toHaveAttribute("data-status", "dismissed");
});

test("the next analysis gets the past decisions", async () => {
  const before = strategyCalls();
  await refresh(page);
  await expect(tips(page).first().locator("h3")).toHaveText(/\(#B\)$/);
  expect(strategyCalls()).toBe(before + 1);
  const system = stub.calls.findLast((c) => c.kind === "strategy")!.system;
  expect(system).toMatch(new RegExp(`- DONE on \\d{4}-\\d{2}-\\d{2}: ${first[0].replace(/[()#]/g, "\\$&")}`));
  expect(system).toMatch(new RegExp(`- DISMISSED on .*: ${first[1].replace(/[()#]/g, "\\$&")}`));
  expect(system).toContain("never repeat or rephrase a DISMISSED idea");
  await expect(page.getByRole("button", { name: "Refresh" })).toBeDisabled();
});

test("AI unavailable: a friendly message and nothing changes", async () => {
  await nextWeek();
  // Restoring the dismissed one changes the decisions, so the next refresh would ask the AI.
  await openDismissed(page);
  await decide(page, first[1], "Restore");
  await expect(page.getByText(/Not for me \(/)).toHaveCount(0);
  const shown = await actions(page);
  stub.state.fail = true;
  try {
    await refresh(page);
    await expect(page.getByTestId("recommendations-notice")).toContainText("We couldn't analyse your account right now");
  } finally {
    stub.state.fail = false;
  }
  expect(await actions(page)).toEqual(shown);
  // A failed analysis doesn't use up the week: Refresh stays open.
  await expect(page.getByRole("button", { name: "Refresh" })).toBeEnabled();
});

test("after a failed analysis the refresh works and locks the new week", async () => {
  await refresh(page);
  await expect(tips(page).first().locator("h3")).toHaveText(/\(#C\)$/);
  await expect(page.getByTestId("next-set")).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh" })).toBeDisabled();
});

test("shows the tips in Arabic, right to left", async () => {
  await switchLanguage(page, "ar");
  await expect(page.getByRole("heading", { name: "التوصيات" })).toBeVisible();
  const tip = tips(page).first();
  await expect(tip.locator("h3")).toHaveText(/^نصيحة .+ \(#C\)$/);
  await expect(tip.locator("h3")).toHaveAttribute("dir", "auto");
  await expect(tip.getByTestId("why")).toContainText("السبب:");
  await expect(tip.getByTestId("impact")).toHaveText(/^تأثير /);
  await switchLanguage(page, "en");
});

test("the weekly cron analyses businesses that are due (and needs the secret)", async ({ request }) => {
  expect((await request.get("/api/cron/recommendations")).status()).toBe(401);
  const before = strategyCalls();
  const res = await request.get("/api/cron/recommendations", { headers: { authorization: `Bearer ${CRON_SECRET}` } });
  expect(res.status()).toBe(200);
  const summary = (await res.json()).data as { due: number; generated: number; failed: number };
  // Mathanet was analysed just now, so it isn't due; the other seeded businesses with Instagram are.
  expect(summary.generated).toBeGreaterThan(0);
  expect(summary.failed).toBe(0);
  expect(strategyCalls()).toBe(before + summary.generated);
});

test("is removed (not grayed out) when the admin turns the feature off", async ({ browser }) => {
  const adminPage = await browser.newPage();
  await login(adminPage, ADMIN);
  const list = await adminPage.request.get("/api/admin/businesses?q=mathanet_baity");
  const businesses = (await list.json()).data as Array<{ id: string }>;
  expect(businesses).toHaveLength(1);
  const setFeature = (on: boolean) => adminPage.request.patch(`/api/admin/businesses/${businesses[0].id}/permissions`, { data: { changes: { recommendations: on } } });

  try {
    expect((await setFeature(false)).ok()).toBe(true);
    await page.goto("/dashboard");
    await expect(page.getByRole("link", { name: "Recommendations" })).toHaveCount(0);
    await page.goto("/recommendations");
    await expect(page.getByText("Sorry, this page isn't available.")).toBeVisible();
    expect((await page.request.get("/api/recommendations")).status()).toBe(404);
    expect((await page.request.patch("/api/recommendations/anything", { data: { status: "done" } })).status()).toBe(404);
  } finally {
    await setFeature(true);
    await adminPage.close();
  }
  await page.goto("/recommendations");
  await expect(page.getByRole("heading", { name: "Recommendations" })).toBeVisible();
});
