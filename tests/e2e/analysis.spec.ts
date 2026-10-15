import { expect, test, type Browser, type Page } from "@playwright/test";
import { startGeminiStub } from "./gemini-stub";

/**
 * The analysis pages, end to end (see playwright.config.ts for how to run): competitor analysis
 * (measured comparison, growth chart, AI comparison with the invented-number guard, caching, the
 * weekly cron, plan limits and lookup messages), marketing methods (AI suggestion, one-tap
 * correction, promoted vs normal), post performance (list + chart, detail with history and the AI
 * note, AI down → numbers only), the assistant's data, navigation, Arabic RTL on a phone, and the
 * feature switches. Uses the seeded "Mathanet Baity" business (Pro, mock Instagram, seeded history)
 * and the Gemini stub; must run on a fresh seed.
 */

const USER = { email: "user@mathanetbaity.dev", password: "User@123" };
const ADMIN = { email: "admin@localgrowth.dev", password: "Admin@123" };
const CRON_SECRET = process.env.CRON_SECRET ?? "e2e-cron";

test.describe.configure({ mode: "serial" });

let page: Page;
let stub: Awaited<ReturnType<typeof startGeminiStub>>;

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

async function asAdmin<T>(browser: Browser, work: (admin: Page, businessId: string) => Promise<T>): Promise<T> {
  const admin = await browser.newPage();
  try {
    await login(admin, ADMIN);
    const list = await admin.request.get("/api/admin/businesses?q=mathanet_baity");
    const [business] = (await list.json()).data as Array<{ id: string }>;
    return await work(admin, business.id);
  } finally {
    await admin.close();
  }
}

const calls = (kind: string) => stub.calls.filter((c) => c.kind === kind);

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  stub = await startGeminiStub();
  page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  await login(page, USER);
  if ((await page.locator("html").getAttribute("dir")) === "rtl") await switchLanguage(page, "en");
});

test.afterAll(async () => {
  await page.close();
  await stub.close();
});

// ── Part 1: competitors ─────────────────────────────────────────────────────────

test("competitor analysis: measured comparison, growth over time and the AI's comparison", async () => {
  await page.goto("/competitors/analysis");
  await expect(page.getByTestId("section-tabs").getByRole("link")).toHaveText(["Accounts", "Analysis"]);
  await expect(page.getByTestId("competitor-limit")).toHaveText("Tracking 4 of 5 competitors on your plan.");
  await expect(page.getByTestId("competitor-chip")).toHaveCount(4);

  const panel = page.getByTestId("competitor-panel");
  const table = panel.getByTestId("comparison-table");
  await expect(table).toContainText("Followers");
  await expect(table.locator('[data-metric="postsPerWeek"]')).toBeVisible();
  await expect(table.locator('[data-metric="engagementPct"]')).toContainText("%");
  await expect(panel.getByTestId("growth-chart")).toBeVisible();
  await expect(panel).toContainText("over 8 weekly snapshots");
  await expect(panel.getByTestId("mix-bars")).toContainText("Reel");
  await expect(panel.getByTestId("days-chart")).toBeVisible();

  // The AI comparison loads after the numbers (Gemini stub), labelled as an estimate.
  const ai = panel.getByTestId("ai-explanation");
  await expect(ai).toContainText("AI · estimate");
  await expect(ai.getByTestId("ai-explanation-text")).toContainText("seems to post mostly Reels in the evening");
  await expect(ai).toContainText("Ideas to try");
  await expect(page.getByTestId("analysis-footnote")).toContainText("correlation, not causation");

  // The data block the AI saw: both accounts' measured numbers.
  const call = calls("competitor").at(-1)!;
  expect(call.system).toContain("### The business (Mathanet Baity)");
  expect(call.system).toContain("### Measured comparison");
});

test("unchanged competitors aren't re-analysed; an invented number is rejected and the numbers stay", async () => {
  const before = calls("competitor").length;
  await page.reload();
  await expect(page.getByTestId("ai-explanation-text")).toContainText("seems to post mostly Reels");
  expect(calls("competitor").length).toBe(before);

  const second = page.getByTestId("competitor-chip").nth(1);
  stub.state.inventFor = ((await second.textContent()) ?? "").trim().replace(/^.*@/, "");
  try {
    await second.click();
    const panel = page.getByTestId("competitor-panel");
    await expect(panel.getByTestId("ai-explanation-unavailable")).toContainText("isn't available right now");
    await expect(panel.getByTestId("comparison-table")).toBeVisible();
    await expect(panel.getByTestId("growth-chart")).toBeVisible();
  } finally {
    stub.state.inventFor = "";
  }
});

test("the weekly cron refreshes competitors (new snapshot) and needs the secret", async ({ request }) => {
  expect((await request.get("/api/cron/analysis")).status()).toBe(401);
  const res = await request.get("/api/cron/analysis", { headers: { authorization: `Bearer ${CRON_SECRET}` } });
  expect(res.ok()).toBe(true);
  const summary = (await res.json()).data;
  expect(summary.snapshots).toBeGreaterThan(0);
  expect(summary.competitors.refreshed).toBeGreaterThan(0);
  await page.reload();
  await expect(page.getByTestId("competitor-panel")).toContainText("over 9 weekly snapshots");
});

test("the competitor limit comes from the plan, and unusable accounts get a clear reason", async ({ browser }) => {
  await asAdmin(browser, async (admin) => {
    expect((await admin.request.patch("/api/admin/settings", { data: { planLimits: { pro: { competitors: 4 } } } })).ok()).toBe(true);
  });
  try {
    const full = await page.request.post("/api/competitors", { data: { handle: "brand.new.shop" } });
    expect(full.status()).toBe(409);
    expect((await full.json()).error.details).toContainEqual({ path: "max", message: "4" });
    await page.goto("/competitors/analysis");
    await expect(page.getByTestId("competitor-limit")).toHaveText("Tracking 4 of 4 competitors on your plan.");
  } finally {
    await asAdmin(browser, (admin) => admin.request.patch("/api/admin/settings", { data: { planLimits: { pro: { competitors: 5 } } } }));
  }
  for (const [handle, reason] of [
    ["private_shop", "private_account"],
    ["personal_shop", "not_business"],
    ["missing_shop", "no_such_account"],
  ]) {
    const res = await page.request.post("/api/competitors", { data: { handle } });
    expect((await res.json()).error.details).toContainEqual({ path: "handle", message: reason });
  }
});

// ── Part 2: methods ─────────────────────────────────────────────────────────────

test("methods: AI suggestions, one-tap correction, promoted vs normal, ranked with post counts", async () => {
  await page.goto("/methods");
  await expect(page.getByRole("heading", { name: "Marketing methods" })).toBeVisible();
  // The rules' guess shows first; the AI's suggestion (stub: every post a giveaway) replaces it.
  const first = page.getByTestId("method-post").first();
  await expect(first.getByTestId("method-source")).toHaveText("AI suggestion");
  await expect(first.getByTestId("method-picker")).toHaveText("Giveaway");
  expect(calls("classify").length).toBeGreaterThan(0);
  await expect(page.getByTestId("method-ranking").locator('[data-method="giveaway"]')).toContainText(/Based on \d+ posts/);

  // One tap to correct: stored as the client's own choice and kept on reload.
  await first.getByTestId("method-picker").click();
  await page.getByTestId("method-option").filter({ hasText: "Collaboration" }).click();
  await expect(first.getByTestId("method-picker")).toHaveText("Collaboration");
  await expect(first.getByTestId("method-source")).toHaveText("Set by you");

  // Promoted: two posts marked → the comparison appears, labelled.
  await first.getByTestId("promoted-toggle").click();
  await page.getByTestId("method-post").nth(1).getByTestId("promoted-toggle").click();
  await expect(page.getByTestId("promoted-card")).toContainText("Based on 2 posts");
  await page.reload();
  await expect(page.getByTestId("method-post").first().getByTestId("method-picker")).toHaveText("Collaboration");
  await expect(page.getByTestId("method-post").first().getByTestId("promoted-toggle")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("competitor-methods")).toContainText("Estimate");
});

// ── Part 3: post performance ────────────────────────────────────────────────────

test("post performance: recent posts with a chart; a post's detail with history and the AI note", async () => {
  await page.goto("/post-performance");
  await expect(page.getByTestId("recent-chart")).toBeVisible();
  await expect(page.getByTestId("recent-post")).toHaveCount(10);
  await page.getByTestId("recent-post").nth(1).click();
  await expect(page).toHaveURL(/\/post-performance\/.+/);
  const metrics = page.getByTestId("post-metrics");
  await expect(metrics.locator('[data-metric="likes"]')).toContainText(/vs [\d,.K]+ average \(\d+ posts\)/);
  await expect(metrics.locator('[data-metric="reach"]')).toBeVisible();
  await expect(page.getByTestId("history-chart")).toBeVisible();
  await expect(page.getByTestId("ai-explanation-text")).toContainText("This post did better than your usual posts.");
  await expect(page.getByTestId("ai-explanation-text")).toContainText("What to learn:");
  const block = calls("postInsight").at(-1)!.system;
  expect(block).toContain("account average");
  expect(block).toContain("daily snapshots");
});

test("with the AI down, the numbers and charts still show", async () => {
  stub.state.fail = true;
  try {
    await page.goto("/post-performance");
    await page.getByTestId("recent-post").nth(2).click();
    await expect(page.getByTestId("ai-explanation-unavailable")).toContainText("All the numbers and charts on this page are complete");
    await expect(page.getByTestId("post-metrics")).toBeVisible();
    await expect(page.getByTestId("history-chart")).toBeVisible();
  } finally {
    stub.state.fail = false;
  }
});

// ── For all three ───────────────────────────────────────────────────────────────

test("the assistant gets the new data in the Analytics and Competitors modes", async () => {
  for (const [mode, section] of [
    ["analytics", "## Marketing methods"],
    ["competitors", "## Competitor analysis"],
  ]) {
    const res = await page.request.post("/api/assistant/messages", { data: { mode, text: `What should I learn from my ${mode}?` } });
    expect(res.status()).toBe(201);
    const system = calls("chat").at(-1)!.system;
    expect(system).toContain(section);
  }
  expect(calls("chat").at(-1)!.system).toContain("Content types (estimated)");
});

test("navigation: the new pages live under Insights and Competitors", async () => {
  await page.goto("/post-performance");
  await expect(page.getByTestId("section-tabs").getByRole("link")).toHaveText(["Recommendations", "Reports", "Post performance", "Methods", "Posting experiment"]);
  await expect(page.locator("aside").getByRole("link", { name: "Insights" })).toHaveAttribute("aria-current", "page");
  await page.goto("/competitors/analysis");
  await expect(page.getByTestId("section-tabs").getByRole("link", { name: "Analysis" })).toHaveAttribute("aria-current", "page");
  await expect(page.locator("aside").getByRole("link", { name: "Competitors" })).toHaveAttribute("aria-current", "page");
});

test("Arabic, right to left, on a phone", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await switchLanguage(page, "ar");
  try {
    await page.goto("/methods");
    await expect(page.getByRole("heading", { name: "أساليب التسويق" })).toBeVisible();
    await page.goto("/competitors/analysis");
    await expect(page.getByRole("heading", { name: "تحليل المنافسين" })).toBeVisible();
    await expect(page.getByTestId("ai-explanation-text")).toContainText("يبدو أنهم ينشرون غالباً ريلز");
    await page.goto("/post-performance");
    await expect(page.getByRole("heading", { name: "أداء المنشورات" })).toBeVisible();
    for (const path of ["/methods", "/competitors/analysis", "/post-performance"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    }
  } finally {
    await switchLanguage(page, "en");
    await page.setViewportSize({ width: 1366, height: 900 });
  }
});

test("feature switches: a page that's off is gone from the navigation and answers 404", async ({ browser }) => {
  const set = (changes: Record<string, boolean>) =>
    asAdmin(browser, async (admin, id) => expect((await admin.request.patch(`/api/admin/businesses/${id}/permissions`, { data: { changes } })).ok()).toBe(true));
  await set({ methods: false, postInsights: false, "competitors.analysis": false });
  try {
    await page.goto("/recommendations");
    await expect(page.getByTestId("section-tabs").getByRole("link")).toHaveText(["Recommendations", "Reports", "Posting experiment"]);
    expect((await page.request.get("/api/methods")).status()).toBe(404);
    expect((await page.request.get("/api/post-performance")).status()).toBe(404);
    expect((await page.request.get("/api/competitors/analysis")).status()).toBe(404);
    expect((await page.request.get("/methods")).status()).toBe(404);
    await page.goto("/competitors");
    await expect(page.getByTestId("section-tabs")).toHaveCount(0);
  } finally {
    await set({ methods: true, postInsights: true, "competitors.analysis": true });
  }
});
