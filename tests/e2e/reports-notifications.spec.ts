import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { startGeminiStub } from "./gemini-stub";

/**
 * Weekly reports and the notification center, end to end (see playwright.config.ts for how to
 * run): the daily cron publishes reports (with an AI summary, or numbers only when the summary
 * quoted an invented number) and notifies; the bell (unread count, open → read, mark all read);
 * a preference switched off really stops that notification; Arabic; the admin feature toggles.
 * Runs after the recommendations spec on a fresh seed (it needs no earlier weekly reports).
 */

const USER = { email: "user@mathanetbaity.dev", password: "User@123" };
const CAFE = { email: "cafe@localgrowth.dev", password: "User@123" };
const ADMIN = { email: "admin@localgrowth.dev", password: "Admin@123" };
const CRON_SECRET = process.env.CRON_SECRET ?? "e2e-cron";
const HANDLE = "mathanet_baity";

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
  // Language lives in the profile menu (the header only shows the Instagram connection).
  await p.getByTestId("profile-menu-trigger").click();
  await p.getByTestId("menu-language").click();
  await expect(p.locator("html")).toHaveAttribute("dir", to === "ar" ? "rtl" : "ltr");
  await saved;
}

const bell = (p: Page) => p.getByTestId("notification-bell");
const unreadCount = async (p: Page) => (await (await p.request.get("/api/notifications")).json()).data.unread as number;
const items = (p: Page) => p.getByTestId("notification");

function simulateDm(text: string) {
  const args = ["--import", "tsx", path.join("scripts", "simulate-dm.ts"), "--handle", HANDLE, "--text", text, "--from", `e2e_${randomUUID().slice(0, 8)}`, "--url", test.info().project.use.baseURL!];
  execFileSync(process.execPath, args, { stdio: "pipe", env: process.env });
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

test("the reports page starts empty", async () => {
  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: "Weekly reports" })).toBeVisible();
  await expect(page.getByText("No reports yet")).toBeVisible();
});

test("the daily cron publishes weekly reports and notifies (and needs the secret)", async ({ request }) => {
  test.setTimeout(240_000);
  expect((await request.get("/api/cron/daily")).status()).toBe(401);
  // The café's summary will quote a number that isn't in its data: its report must go out with numbers only.
  stub.state.inventNumbersFor = "Dalla & Bean";
  try {
    const res = await request.get("/api/cron/daily", { headers: { authorization: `Bearer ${CRON_SECRET}` }, timeout: 230_000 });
    expect(res.status()).toBe(200);
    const summary = (await res.json()).data as { reports: { created: number; failed: number } };
    expect(summary.reports.created).toBeGreaterThanOrEqual(2);
    expect(summary.reports.failed).toBe(0);
  } finally {
    stub.state.inventNumbersFor = "";
  }
  const reportCall = stub.calls.find((c) => c.kind === "report" && c.system.includes("Mathanet Baity"))!;
  expect(reportCall.system).toContain("<week_numbers>");
  expect(reportCall.system).toContain("Data: the app's demo data");
});

test("the bell shows the unread count; opening a notification goes to its page and marks it read", async () => {
  await page.goto("/dashboard");
  const before = await unreadCount(page);
  expect(before).toBeGreaterThan(0);
  await expect(bell(page)).toHaveAttribute("aria-label", `Notifications, ${before} unread`);
  await bell(page).click();
  const report = items(page).filter({ hasText: "Your weekly report is ready" });
  await expect(report).toHaveAttribute("data-read", "false");
  await report.click();
  await expect(page).toHaveURL(/\/reports#\w+/);
  await expect.poll(() => unreadCount(page)).toBe(before - 1);

  const latest = page.getByTestId("weekly-report").first();
  await expect(latest.getByTestId("report-summary")).toContainText("A steady week compared with the one before.");
  await expect(latest).toContainText("Demo data");
  for (const label of ["Posts", "Total reach", "Avg likes + comments per post", "Engagement rate", "Net new followers"]) {
    await expect(latest.getByRole("cell", { name: label, exact: true })).toBeVisible();
  }
  await expect(latest).toContainText("Top post");
});

test("a summary with an invented number is dropped: numbers only; a preference that's off sends nothing", async ({ browser }) => {
  const cafe = await browser.newPage();
  try {
    await login(cafe, CAFE);
    await cafe.goto("/reports");
    await expect(cafe.getByTestId("weekly-report").first().getByTestId("report-numbers-only")).toBeVisible();
    await expect(cafe.getByText("987654")).toHaveCount(0);
    // The café's seeded preferences have "Weekly report" off.
    const list = (await (await cafe.request.get("/api/notifications")).json()).data.items as Array<{ type: string }>;
    expect(list.some((n) => n.type === "weekly_report")).toBe(false);
  } finally {
    await cafe.close();
  }
});

test("replies waiting: switched off in Settings → nothing; on → one notification with the count", async () => {
  test.setTimeout(120_000);
  const toggle = () => page.getByRole("switch", { name: /Replies need approval/ });
  const repliesNotification = async () => ((await (await page.request.get("/api/notifications")).json()).data.items as Array<{ type: string; read: boolean; params: { count?: number } }>).find((n) => n.type === "replies_waiting");

  await page.goto("/settings");
  await expect(page.getByText("Shown in the bell at the top of the app.")).toBeVisible();
  await expect(toggle()).toBeChecked();
  const off = page.waitForResponse((r) => r.url().endsWith("/api/me/notifications") && r.request().method() === "PATCH");
  await toggle().click();
  await off;
  simulateDm("Do you have saffron cashews today?");
  // The webhook works after answering; give it time, then check nothing arrived.
  await expect.poll(async () => (await (await page.request.get("/api/reply-drafts")).json()).data.length, { timeout: 20_000 }).toBeGreaterThan(0);
  expect(await repliesNotification()).toBeUndefined();

  await page.reload();
  const on = page.waitForResponse((r) => r.url().endsWith("/api/me/notifications") && r.request().method() === "PATCH");
  await toggle().click();
  await on;
  simulateDm("And do you deliver to Jahra?");
  await expect.poll(async () => (await repliesNotification())?.read, { timeout: 20_000 }).toBe(false);
  expect((await repliesNotification())!.params.count).toBeGreaterThanOrEqual(2);
  await page.goto("/dashboard");
  await bell(page).click();
  await expect(items(page).filter({ hasText: "Replies waiting for approval" })).toContainText(/\d+ comment or DM replies are waiting for you/);
  await page.keyboard.press("Escape");
});

test("mark all as read clears the count", async () => {
  await page.goto("/dashboard");
  await bell(page).click();
  await page.getByRole("button", { name: "Mark all as read" }).click();
  await expect(bell(page)).toHaveAttribute("aria-label", "Notifications");
  await expect.poll(() => unreadCount(page)).toBe(0);
  await page.keyboard.press("Escape");
});

test("Arabic, right to left, and the bell on a phone", async () => {
  await page.goto("/reports");
  await switchLanguage(page, "ar");
  await expect(page.getByRole("heading", { name: "التقارير الأسبوعية" })).toBeVisible();
  await expect(page.getByTestId("report-summary").first()).toContainText("أسبوع مستقر");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await bell(page).click();
  await expect(items(page).filter({ hasText: "تقريركم الأسبوعي جاهز" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1280, height: 720 });
  await switchLanguage(page, "en");
});

test("reports and notifications are removed (not grayed out) when the admin turns them off", async ({ browser }) => {
  const adminPage = await browser.newPage();
  await login(adminPage, ADMIN);
  const list = await adminPage.request.get(`/api/admin/businesses?q=${HANDLE}`);
  const [business] = (await list.json()).data as Array<{ id: string }>;
  const set = (changes: Record<string, boolean>) => adminPage.request.patch(`/api/admin/businesses/${business.id}/permissions`, { data: { changes } });
  try {
    expect((await set({ notifications: false, reports: false })).ok()).toBe(true);
    await page.goto("/dashboard");
    await expect(bell(page)).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Reports" })).toHaveCount(0);
    expect((await page.request.get("/api/notifications")).status()).toBe(404);
    await page.goto("/reports");
    await expect(page.getByText("Sorry, this page isn't available.")).toBeVisible();
    await page.goto("/settings");
    await expect(page.getByText("Shown in the bell at the top of the app.")).toHaveCount(0);
  } finally {
    await set({ notifications: true, reports: true });
    await adminPage.close();
  }
  await page.goto("/dashboard");
  await expect(bell(page)).toBeVisible();
});
