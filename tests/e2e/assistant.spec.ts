import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * AI assistant, end to end (see playwright.config.ts for how to run): ask in each mode,
 * follow-ups with history, Arabic (RTL), "AI unavailable" without a fake answer, deleting
 * a chat, and the admin feature toggle. The app must run with AI_PROVIDER=gemini and
 * GEMINI_API_BASE pointing at the Gemini stub this spec starts (E2E_GEMINI_STUB_PORT,
 * default 4010) — Google is never called. Uses the seeded "Mathanet Baity" demo business.
 */

const USER = { email: "user@mathanetbaity.dev", password: "User@123" };
const ADMIN = { email: "admin@localgrowth.dev", password: "Admin@123" };
const STUB_PORT = Number(process.env.E2E_GEMINI_STUB_PORT ?? 4010);
const RUN = randomUUID().slice(0, 6);

test.describe.configure({ mode: "serial" });

interface StubCall {
  system: string;
  turns: Array<{ role: string; text: string }>;
}
const calls: StubCall[] = [];
let stub: Server;
let page: Page;

/** A local stand-in for Gemini's generateContent: answers with what it was asked, or fails on "[down]". */
function startStub(): Promise<void> {
  stub = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}") as { systemInstruction?: { parts: Array<{ text: string }> }; contents?: Array<{ role: string; parts: Array<{ text: string }> }> };
      const turns = (body.contents ?? []).map((c) => ({ role: c.role, text: c.parts.map((p) => p.text).join("") }));
      calls.push({ system: body.systemInstruction?.parts[0]?.text ?? "", turns });
      const question = turns.at(-1)?.text ?? "";
      res.setHeader("content-type", "application/json");
      if (question.includes("[down]")) {
        res.statusCode = 503;
        res.end(JSON.stringify({ error: { code: 503, status: "UNAVAILABLE", message: "The model is overloaded." } }));
        return;
      }
      const arabic = /[؀-ۿ]/.test(question);
      const text = arabic ? `إجابة تجريبية (${turns.length}): ${question}` : `**Stub answer** (${turns.length} turns) to: ${question}`;
      res.end(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ text }] } }] }));
    });
  });
  return new Promise((resolve) => stub.listen(STUB_PORT, "127.0.0.1", resolve));
}

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
  await p.getByRole("button", { name: to === "ar" ? "Change language" : "تغيير اللغة" }).first().click();
  await expect(p.locator("html")).toHaveAttribute("dir", to === "ar" ? "rtl" : "ltr");
  await saved;
}

async function ask(p: Page, question: string, label = "Your question") {
  await p.getByLabel(label).fill(question);
  await p.getByLabel(label).press("Enter");
}

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  await startStub();
  page = await browser.newPage();
  await login(page, USER);
  if ((await page.locator("html").getAttribute("dir")) === "rtl") await switchLanguage(page, "en");
});

test.afterAll(async () => {
  await page.close();
  await new Promise((resolve) => stub.close(resolve));
});

test("opens from the navigation with the three modes", async () => {
  await page.goto("/dashboard", { waitUntil: "networkidle" });
  await page.getByRole("link", { name: "AI Assistant" }).first().click();
  await expect(page).toHaveURL(/\/assistant$/);
  await expect(page.getByRole("heading", { name: "AI Assistant" })).toBeVisible();
  for (const mode of ["Post", "Analytics", "Competitors"]) await expect(page.getByRole("radio", { name: mode })).toBeVisible();
  await expect(page.getByText("How can I help?")).toBeVisible();
});

test("answers from the business's data, saves the chat and sends history on follow-ups", async () => {
  await page.getByRole("radio", { name: "Analytics" }).click();
  const before = calls.length;
  await ask(page, `How is my account doing? ${RUN}`);
  await expect(page.getByText(`Stub answer (1 turns) to: How is my account doing? ${RUN}`)).toBeVisible();
  // Markdown is cleaned up before it's shown or saved.
  await expect(page.getByText("**Stub answer**")).toHaveCount(0);

  const call = calls[before];
  expect(call.system).toContain("Mode: ANALYTICS");
  expect(call.system).toContain("<business_data>");
  expect(call.system).toContain("Accounts reached:");
  expect(call.system).toContain("demo connection");

  await ask(page, "And which post did best?");
  await expect(page.getByText("Stub answer (3 turns) to: And which post did best?")).toBeVisible();
  expect(calls.at(-1)!.turns.map((t) => t.role)).toEqual(["user", "model", "user"]);

  // The chat survives a reload and is listed under "Your chats".
  await page.reload();
  await page.getByRole("button", { name: "Your chats" }).click();
  await page.getByRole("menuitem", { name: new RegExp(`How is my account doing\\? ${RUN}`) }).click();
  await expect(page.getByText("Stub answer (3 turns) to: And which post did best?")).toBeVisible();
});

test("replies in Arabic to an Arabic question, right to left", async () => {
  await switchLanguage(page, "ar");
  await page.getByRole("button", { name: "محادثة جديدة" }).click();
  await page.getByRole("radio", { name: "منشور" }).click();
  await ask(page, `ماذا أنشر هذا الأسبوع؟ ${RUN}`, "سؤالكم");
  const answer = page.getByText(`إجابة تجريبية (1): ماذا أنشر هذا الأسبوع؟ ${RUN}`);
  await expect(answer).toBeVisible();
  await expect(answer).toHaveAttribute("dir", "auto");
  expect(calls.at(-1)!.system).toContain("Mode: POST");
  expect(calls.at(-1)!.system).toContain("Reply in Arabic");
  await switchLanguage(page, "en");
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
  await expect(page.getByText(/questions today/)).toHaveText(usage);
});

test("deletes a chat", async () => {
  await page.getByRole("button", { name: "Your chats" }).click();
  await page.getByRole("menuitem", { name: new RegExp(`How is my account doing\\? ${RUN}`) }).click();
  await expect(page.getByText("Stub answer (3 turns) to: And which post did best?")).toBeVisible();
  const overview = await (await page.request.get("/api/assistant")).json();
  const id = (overview.data.conversations as Array<{ id: string; title: string }>).find((c) => c.title.includes(RUN) && c.title.startsWith("How is"))!.id;

  await page.getByRole("button", { name: "Delete chat" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("How can I help?")).toBeVisible();
  expect((await page.request.get(`/api/assistant/conversations/${id}`)).status()).toBe(404);
  await page.reload();
  await page.getByRole("button", { name: "Your chats" }).click();
  await expect(page.getByRole("menuitem", { name: new RegExp(`How is my account doing\\? ${RUN}`) })).toHaveCount(0);
  await page.keyboard.press("Escape");
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
    await expect(page.getByRole("link", { name: "AI Assistant" })).toHaveCount(0);
    await page.goto("/assistant");
    await expect(page.getByText("Sorry, this page isn't available.")).toBeVisible();
    expect((await page.request.get("/api/assistant")).status()).toBe(404);
  } finally {
    await setFeature(true);
    await adminPage.close();
  }
  await page.goto("/assistant");
  await expect(page.getByRole("heading", { name: "AI Assistant" })).toBeVisible();
});
