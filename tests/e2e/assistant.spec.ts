import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { startGeminiStub } from "./gemini-stub";

/**
 * AI assistant, end to end (see playwright.config.ts for how to run): opened from the footer
 * banner (a panel on desktop, full screen on phones), ask in each mode,
 * follow-ups with history, Arabic (RTL), "AI unavailable" without a fake answer, deleting
 * a chat, and the admin feature toggle. The app must run with AI_PROVIDER=gemini and
 * GEMINI_API_BASE pointing at the Gemini stub this spec starts (E2E_GEMINI_STUB_PORT,
 * default 4010) — Google is never called. Uses the seeded "Mathanet Baity" demo business.
 */

const USER = { email: "user@mathanetbaity.dev", password: "User@123" };
const ADMIN = { email: "admin@localgrowth.dev", password: "Admin@123" };
const RUN = randomUUID().slice(0, 6);

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

/** Switches the UI language with the top-bar toggle and waits until it's saved to the account. */
async function switchLanguage(p: Page, to: "en" | "ar") {
  const saved = p.waitForResponse((r) => r.url().includes("/api/me/preferences") && r.request().method() === "PATCH");
  // Language lives in the profile menu (the header only shows the Instagram connection).
  await p.getByTestId("profile-menu-trigger").click();
  await p.getByTestId("menu-language").click();
  await expect(p.locator("html")).toHaveAttribute("dir", to === "ar" ? "rtl" : "ltr");
  await saved;
}

async function ask(p: Page, question: string, label = "Your question") {
  await p.getByLabel(label).fill(question);
  await p.getByLabel(label).press("Enter");
}

const panel = (p: Page) => p.getByTestId("assistant-panel");

async function openPanel(p: Page) {
  await p.getByTestId("assistant-banner").click();
  await expect(panel(p)).toBeVisible();
}

async function closePanel(p: Page) {
  await p.getByRole("button", { name: "Close the assistant" }).click();
  await expect(panel(p)).toHaveCount(0);
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

test("opens from the footer banner (no sidebar item) with the three modes, and closes", async () => {
  await page.goto("/dashboard", { waitUntil: "networkidle" });
  await expect(page.getByRole("link", { name: "AI Assistant" })).toHaveCount(0);
  await expect(page.getByTestId("assistant-banner")).toContainText("Ask your AI assistant");
  await openPanel(page);
  await expect(panel(page).getByRole("heading", { name: "AI Assistant" })).toBeVisible();
  for (const mode of ["Post", "Analytics", "Competitors"]) await expect(panel(page).getByRole("radio", { name: mode })).toBeVisible();
  await expect(panel(page).getByText("How can I help?")).toBeVisible();
  await closePanel(page);
  await openPanel(page);
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  await openPanel(page);
});

test("answers from the business's data, saves the chat and sends history on follow-ups", async () => {
  await page.getByRole("radio", { name: "Analytics" }).click();
  const before = stub.calls.length;
  await ask(page, `How is my account doing? ${RUN}`);
  await expect(page.getByText(`Stub answer (1 turns) to: How is my account doing? ${RUN}`)).toBeVisible();
  // Markdown is cleaned up before it's shown or saved.
  await expect(page.getByText("**Stub answer**")).toHaveCount(0);

  const call = stub.calls[before];
  expect(call.system).toContain("Mode: ANALYTICS");
  expect(call.system).toContain("<business_data>");
  expect(call.system).toContain("Accounts reached:");
  expect(call.system).toContain("demo connection");

  await ask(page, "And which post did best?");
  await expect(page.getByText("Stub answer (3 turns) to: And which post did best?")).toBeVisible();
  expect(stub.calls.at(-1)!.turns.map((t) => t.role)).toEqual(["user", "model", "user"]);

  // The chat survives a reload and is listed under "Your chats".
  await page.reload();
  await openPanel(page);
  await page.getByRole("button", { name: "Your chats" }).click();
  await page.getByRole("menuitem", { name: new RegExp(`How is my account doing\\? ${RUN}`) }).click();
  await expect(page.getByText("Stub answer (3 turns) to: And which post did best?")).toBeVisible();
});

test("replies in Arabic to an Arabic question, right to left", async () => {
  await closePanel(page);
  await switchLanguage(page, "ar");
  await expect(page.getByTestId("assistant-banner")).toContainText("اسألوا مساعدكم الذكي");
  await page.getByTestId("assistant-banner").click();
  await expect(panel(page)).toBeVisible();
  await page.getByRole("button", { name: "محادثة جديدة" }).click();
  await page.getByRole("radio", { name: "منشور" }).click();
  await ask(page, `ماذا أنشر هذا الأسبوع؟ ${RUN}`, "سؤالكم");
  const answer = page.getByText(`إجابة تجريبية (1): ماذا أنشر هذا الأسبوع؟ ${RUN}`);
  await expect(answer).toBeVisible();
  await expect(answer).toHaveAttribute("dir", "auto");
  expect(stub.calls.at(-1)!.system).toContain("Mode: POST");
  expect(stub.calls.at(-1)!.system).toContain("Reply in Arabic");
  await page.getByRole("button", { name: "إغلاق المساعد" }).click();
  await switchLanguage(page, "en");
  await openPanel(page);
});

test("says the AI is unavailable instead of answering, and keeps the question", async () => {
  await page.getByRole("button", { name: "New chat" }).click();
  const usage = await page.getByText(/questions today/).innerText();
  const question = `Compare me with my competitors [down] ${RUN}`;
  await page.getByRole("radio", { name: "Competitors" }).click();
  await ask(page, question);
  await expect(page.locator("section p[role=alert]")).toContainText("The assistant isn't available right now");
  await expect(page.getByLabel("Your question")).toHaveValue(question);
  // Nothing was saved: no answer bubble, same count of questions.
  await expect(page.getByText(/Stub answer/)).toHaveCount(0);
  await page.reload();
  await openPanel(page);
  await expect(page.getByText(/questions today/)).toHaveText(usage);
});

test("deletes a chat", async () => {
  await page.getByRole("button", { name: "Your chats" }).click();
  await page.getByRole("menuitem", { name: new RegExp(`How is my account doing\\? ${RUN}`) }).click();
  await expect(page.getByText("Stub answer (3 turns) to: And which post did best?")).toBeVisible();
  const overview = await (await page.request.get("/api/assistant")).json();
  const id = (overview.data.conversations as Array<{ id: string; title: string }>).find((c) => c.title.includes(RUN) && c.title.startsWith("How is"))!.id;

  await page.getByRole("button", { name: "Delete chat" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("How can I help?")).toBeVisible();
  expect((await page.request.get(`/api/assistant/conversations/${id}`)).status()).toBe(404);
  await page.reload();
  await openPanel(page);
  await page.getByRole("button", { name: "Your chats" }).click();
  await expect(page.getByRole("menuitem", { name: new RegExp(`How is my account doing\\? ${RUN}`) })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await closePanel(page);
});

test("on a phone: full width above the tab bar, nothing hidden behind it, full-screen chat", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  const banner = page.getByTestId("assistant-banner");
  await expect(banner).toBeVisible();
  const bar = (await banner.boundingBox())!;
  const tabs = (await page.getByRole("navigation").last().boundingBox())!;
  expect(bar.y + bar.height).toBeLessThanOrEqual(tabs.y + 1);
  expect(bar.width).toBeGreaterThan(340);
  // The page leaves room at the bottom for the banner and the tab bar.
  const padding = await page.locator("main").evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom));
  expect(padding).toBeGreaterThanOrEqual(844 - bar.y);
  await openPanel(page);
  const box = (await panel(page).boundingBox())!;
  expect(Math.round(box.width)).toBe(390);
  expect(Math.round(box.height)).toBe(844);
  await closePanel(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  // Desktop: a centred bar, not edge to edge.
  await page.goto("/dashboard");
  const desktopBar = (await page.getByTestId("assistant-banner").boundingBox())!;
  expect(desktopBar.width).toBeLessThan(700);
});

test("is removed (not grayed out) when the admin turns the feature off", async ({ browser }) => {
  const adminPage = await browser.newPage();
  await login(adminPage, ADMIN);
  const list = await adminPage.request.get("/api/admin/businesses?q=mathanet_baity");
  const businesses = (await list.json()).data as Array<{ id: string }>;
  expect(businesses).toHaveLength(1);
  const setFeature = (on: boolean) => adminPage.request.patch(`/api/admin/businesses/${businesses[0].id}/permissions`, { data: { changes: { assistant: on } } });

  try {
    expect((await setFeature(false)).ok()).toBe(true);
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByTestId("assistant-banner")).toHaveCount(0);
    await page.goto("/assistant");
    await expect(page.getByText("Sorry, this page isn't available.")).toBeVisible();
    expect((await page.request.get("/api/assistant")).status()).toBe(404);
  } finally {
    await setFeature(true);
    await adminPage.close();
  }
  await page.goto("/dashboard");
  await expect(page.getByTestId("assistant-banner")).toBeVisible();
});
