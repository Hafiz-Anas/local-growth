import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { startGeminiStub } from "./gemini-stub";

/**
 * AI strategy recommendations, end to end (see playwright.config.ts for how to run): first
 * analysis, the "unchanged" cache, accept / dismiss / done with the outcome note, past decisions
 * fed into the next analysis, "AI unavailable" without changing anything, the daily refresh
 * limit, Arabic (RTL), the weekly cron and the admin feature toggle. The app must run with
 * AI_PROVIDER=gemini, GEMINI_API_BASE at the Gemini stub and CRON_SECRET (default "e2e-cron").
 * Uses the seeded "Mathanet Baity" demo business, which must have no analysis yet (fresh seed).
 */

const USER = { email: "user@mathanetbaity.dev", password: "User@123" };
const ADMIN = { email: "admin@localgrowth.dev", password: "Admin@123" };
const CRON_SECRET = process.env.CRON_SECRET ?? "e2e-cron";

test.describe.configure({ mode: "serial" });

let stub: Awaited<ReturnType<typeof startGeminiStub>>;
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
  await p.getByRole("button", { name: to === "ar" ? "Change language" : "تغيير اللغة" }).first().click();
  await expect(p.locator("html")).toHaveAttribute("dir", to === "ar" ? "rtl" : "ltr");
  await saved;
}

const card = (p: Page, action: string): Locator => p.getByTestId("recommendation").filter({ hasText: action });
const strategyCalls = () => stub.calls.filter((c) => c.kind === "strategy").length;

/** Clicks a decision button on a card and waits until it's saved. */
async function decide(p: Page, action: string, button: string) {
  const saved = p.waitForResponse((r) => /\/api\/recommendations\/[\w-]+$/.test(r.url()) && r.request().method() === "PATCH");
  await card(p, action).getByRole("button", { name: button }).click();
  expect((await saved).ok()).toBe(true);
}

/** Opens the collapsed "Dismissed" list (a <details>; clicking its summary would toggle it). */
async function openDismissed(p: Page) {
  await p.locator("details").filter({ hasText: "Dismissed (" }).evaluate((d) => ((d as HTMLDetailsElement).open = true));
}

async function refresh(p: Page) {
  const done = p.waitForResponse((r) => r.url().endsWith("/api/recommendations/refresh"));
  await p.getByRole("button", { name: "Refresh" }).click();
  return done;
}

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  stub = await startGeminiStub();
  page = await browser.newPage();
  await login(page, USER);
  if ((await page.locator("html").getAttribute("dir")) === "rtl") await switchLanguage(page, "en");
});

test.afterAll(async () => {
  await page.close();
  await stub.close();
});

test("first analysis: 3–5 actions with rationale, confidence and post counts", async () => {
  await page.goto("/dashboard", { waitUntil: "networkidle" });
  await page.getByRole("link", { name: "Recommendations" }).first().click();
  await expect(page).toHaveURL(/\/recommendations$/);
  await expect(page.getByText("No recommendations yet")).toBeVisible();

  await refresh(page);
  await expect(page.getByTestId("recommendation")).toHaveCount(3);
  const reel = card(page, "Post a Reel on Thursday evening (#1)");
  await expect(reel).toContainText("Strong");
  await expect(reel).toContainText("Based on 12 posts");
  await expect(reel).toContainText("This is a pattern, not proof.");
  // The app caps the model's "strong" by the evidence: 3 posts → early signal, 7 → moderate.
  await expect(card(page, "Reply to every comment within an hour (#1)")).toContainText("Early signal");
  await expect(card(page, "Show the roasting process in a carousel (#1)")).toContainText("Moderate");
  await expect(page.getByText("2 of 3 refreshes left today")).toBeVisible();

  const call = stub.calls.findLast((c) => c.kind === "strategy")!;
  expect(call.system).toContain("<business_data>");
  expect(call.system).toContain("By weekday");
  expect(call.system).toContain("<past_decisions>\nNone yet.");
});

test("unchanged data isn't re-analysed", async () => {
  const before = strategyCalls();
  await refresh(page);
  await expect(page.getByTestId("recommendations-notice")).toContainText("Nothing has changed since the last analysis");
  expect(strategyCalls()).toBe(before);
  await expect(page.getByText("2 of 3 refreshes left today")).toBeVisible();
});

test("accept, dismiss and done are saved with their date; done waits 7 days for its outcome", async () => {
  await decide(page, "Post a Reel on Thursday evening (#1)", "Accept");
  await decide(page, "Reply to every comment within an hour (#1)", "Dismiss");
  await decide(page, "Show the roasting process in a carousel (#1)", "Mark done");

  await page.reload();
  await expect(page.getByRole("heading", { name: "In progress" })).toBeVisible();
  await expect(card(page, "Post a Reel on Thursday evening (#1)")).toHaveAttribute("data-status", "accepted");
  await expect(card(page, "Post a Reel on Thursday evening (#1)")).toContainText(/Accepted (\w+ \d+|\d+ \w+)/);
  const done = card(page, "Show the roasting process in a carousel (#1)");
  await expect(done).toHaveAttribute("data-status", "done");
  await expect(done.getByTestId("outcome-pending")).toContainText("We'll compare your average likes + comments per post on");
  await openDismissed(page);
  await expect(card(page, "Reply to every comment within an hour (#1)")).toHaveAttribute("data-status", "dismissed");
});

test("the next analysis gets the past decisions and doesn't repeat dismissed ideas", async () => {
  const before = strategyCalls();
  await refresh(page);
  await expect(card(page, "Post a Reel on Thursday evening (#2)")).toBeVisible();
  expect(strategyCalls()).toBe(before + 1);
  const system = stub.calls.findLast((c) => c.kind === "strategy")!.system;
  expect(system).toMatch(/- DISMISSED on \d{4}-\d{2}-\d{2}: Reply to every comment within an hour \(#1\)/);
  expect(system).toMatch(/- ACCEPTED \(in progress\) on .*: Post a Reel on Thursday evening \(#1\)/);
  expect(system).toMatch(/- DONE on .*: Show the roasting process in a carousel \(#1\)/);
  expect(system).toContain("never repeat or rephrase a DISMISSED idea");
  await expect(page.getByText("1 of 3 refreshes left today")).toBeVisible();
});

test("AI unavailable: a friendly message and nothing changes", async () => {
  // Restoring the dismissed one changes the decisions, so the next refresh would ask the AI.
  await openDismissed(page);
  await decide(page, "Reply to every comment within an hour (#1)", "Restore");
  await expect(page.getByText(/Dismissed \(/)).toHaveCount(0);
  stub.state.fail = true;
  try {
    await refresh(page);
    await expect(page.getByTestId("recommendations-notice")).toContainText("We couldn't analyse your account right now");
  } finally {
    stub.state.fail = false;
  }
  await expect(card(page, "Post a Reel on Thursday evening (#2)")).toBeVisible();
  await expect(page.getByText("1 of 3 refreshes left today")).toBeVisible();
});

test("manual refreshes are limited per day", async () => {
  await refresh(page);
  await expect(card(page, "Post a Reel on Thursday evening (#3)")).toBeVisible();
  await expect(page.getByText("0 of 3 refreshes left today")).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh" })).toBeDisabled();
  const res = await page.request.post("/api/recommendations/refresh");
  expect(res.status()).toBe(429);
  expect((await res.json()).error.code).toBe("recommendations_limit");
});

test("shows the recommendations in Arabic, right to left", async () => {
  await switchLanguage(page, "ar");
  await expect(page.getByRole("heading", { name: "التوصيات" })).toBeVisible();
  const reel = card(page, "انشروا ريل مساء الخميس (#3)");
  await expect(reel).toContainText(/مبنية على (12|١٢) منشور/);
  await expect(reel.locator("h3")).toHaveAttribute("dir", "auto");
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
  } finally {
    await setFeature(true);
    await adminPage.close();
  }
  await page.goto("/recommendations");
  await expect(page.getByRole("heading", { name: "Recommendations" })).toBeVisible();
});
