import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { startGeminiStub } from "./gemini-stub";

/**
 * The reply queue (Engagement → DM replies / Keyword replies), end to end: tap to edit with a character counter and Instagram's
 * limits, Send / Cancel, Regenerate with a tone, learning from edits (the next AI draft's prompt
 * carries the anonymised edit), the Sent tab (as-is / edited / written by you) and the as-is rate on
 * Reply settings, the AI being
 * unavailable (only Regenerate is disabled), a deleted comment, Arabic RTL and phone width.
 * Uses the seeded "Dalla & Bean" business (mock Instagram) and the Gemini stub (see playwright.config.ts).
 */

const USER = { email: "cafe@localgrowth.dev", password: "User@123" };
const HANDLE = "dallabean.kw";
const RUN = randomUUID().slice(0, 6);
const CUSTOMER = `e2e_sara_${RUN}`;

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

function run(script: string, args: string[]) {
  execFileSync(process.execPath, ["--import", "tsx", path.join("scripts", script), "--handle", HANDLE, ...args, "--url", test.info().project.use.baseURL!], { stdio: "pipe", env: process.env });
}
const simulateDm = (text: string, from: string) => run("simulate-dm.ts", ["--text", text, "--from", from]);
const simulateComment = (text: string, commentId: string) => run("simulate-comment.ts", ["--text", text, "--from", `e2e_c_${RUN}`, "--comment-id", commentId]);

const item = (text: string) => page.getByTestId("reply-item").filter({ hasText: text });

/** The webhook works after answering: reload until the draft is in the queue. */
async function waitForItem(text: string) {
  await expect(async () => {
    await page.reload();
    await expect(item(text)).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 25_000 });
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

test("a DM draft can be edited with a counter and Instagram's limit, cancelled, then sent", async () => {
  await page.goto("/engagement/messages");
  simulateDm(`Hi, I'm Sara. Do you have oat milk? ${RUN}`, CUSTOMER);
  await waitForItem(`oat milk? ${RUN}`);
  const draft = item(`oat milk? ${RUN}`);
  await expect(draft.getByTestId("reply-text")).toContainText("Thanks for your message!");
  await expect(draft.getByTestId("reply-window")).toContainText("reply within 24 h");

  // Tap to edit → counter; Cancel keeps the original.
  await draft.getByTestId("reply-text").click();
  const editor = draft.getByTestId("reply-editor");
  await expect(editor).toBeFocused();
  await expect(draft.getByTestId("reply-counter")).toContainText("/1,000");
  await editor.fill("x".repeat(1001));
  await expect(draft.getByTestId("reply-counter")).toHaveText("1,001/1,000");
  await expect(draft.getByRole("alert")).toContainText("Too long for Instagram");
  await expect(draft.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
  await draft.getByRole("button", { name: "Cancel" }).click();
  await expect(draft.getByTestId("reply-text")).toContainText("Thanks for your message!");

  // Edit and send.
  await draft.getByTestId("reply-text").click();
  await draft.getByTestId("reply-editor").fill("Hi Sara! Yes, we have oat milk every day ☕ See you soon at Dalla & Bean.");
  await draft.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("Reply sent as a DM")).toBeVisible();
  await expect(draft).toBeHidden();
});

test("the Sent tab shows how each reply went out; Reply settings shows the as-is rate", async () => {
  await page.getByTestId("replies-tab-sent").click();
  const sent = page.getByTestId("sent-reply").filter({ hasText: `oat milk? ${RUN}` });
  await expect(sent).toBeVisible();
  await expect(sent.getByTestId("sent-outcome")).toHaveText("Written by you");
  await sent.getByRole("button", { name: "See AI draft" }).click();
  await expect(sent).toContainText("AI draft: Thanks for your message!");
  // A DM reply is only on the DM tab.
  await page.goto("/engagement/comments");
  await page.getByTestId("replies-tab-sent").click();
  await expect(page.getByTestId("sent-reply").filter({ hasText: `oat milk? ${RUN}` })).toHaveCount(0);

  await page.goto("/engagement/settings");
  await expect(page.getByTestId("reply-summary")).toContainText("Last 30 days");
  await expect(page.getByTestId("reply-summary")).toContainText("Written by you · ");
  await page.goto("/engagement/messages");
});

test("the next AI draft learns from the edit, without the customer's details", async () => {
  const before = stub.calls.length;
  simulateDm(`Is the café open on Friday? ${RUN}`, `e2e_ali_${RUN}`);
  await waitForItem(`open on Friday? ${RUN}`);
  const call = stub.calls.slice(before).findLast((c) => c.kind === "reply")!;
  expect(call).toBeTruthy();
  const prompt = call.turns.at(-1)!.text;
  expect(prompt).toContain("<edited_drafts>");
  expect(prompt).toContain("Sent instead: Hi {name}! Yes, we have oat milk every day ☕ See you soon at Dalla & Bean.");
  // The earlier customer's message and handle never reach the prompt.
  expect(prompt).not.toContain(CUSTOMER);
  expect(prompt).not.toContain("Do you have oat milk");
});

test("Regenerate asks the AI for a new draft in the chosen tone", async () => {
  const draft = item(`open on Friday? ${RUN}`);
  await draft.getByRole("button", { name: "Regenerate" }).click();
  await draft.getByTestId("regenerate-tones").getByRole("button", { name: "Shorter" }).click();
  await expect(draft.getByTestId("reply-text")).toContainText(/New draft \(shorter\) v\d+/);
  const call = stub.calls.findLast((c) => c.kind === "reply")!;
  expect(call.turns.at(-1)!.text).toContain("<previous_draft>\nThanks for your message!");

  await draft.getByRole("button", { name: "Regenerate" }).click();
  await draft.getByTestId("regenerate-tones").getByRole("button", { name: "More formal" }).click();
  await expect(draft.getByTestId("reply-text")).toContainText(/New draft \(formal\) v\d+/);
});

test("when the AI is unavailable only Regenerate is disabled; editing and sending still work", async () => {
  const draft = item(`open on Friday? ${RUN}`);
  stub.state.fail = true;
  try {
    await draft.getByRole("button", { name: "Regenerate" }).click();
    await draft.getByTestId("regenerate-tones").getByRole("button", { name: "New version" }).click();
    await expect(draft.getByTestId("regenerate-unavailable")).toContainText("The AI can't write a new draft right now");
    await expect(draft.getByRole("button", { name: "Regenerate" })).toBeDisabled();
    await expect(draft.getByTestId("reply-text")).toContainText(/New draft \(formal\)/);

    await draft.getByTestId("reply-text").click();
    await draft.getByTestId("reply-editor").fill("Yes, we're open on Friday from 7 am.");
    await draft.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText("Reply sent as a DM")).toBeVisible();
    await expect(draft).toBeHidden();
  } finally {
    stub.state.fail = false;
  }
});

test("a reply to a deleted comment shows a clear warning and can be removed", async () => {
  const keyword = `HOURS${RUN}`;
  const created = await page.request.post("/api/engagement/rules", { data: { keywords: [keyword], commentReply: "We're open 7 am – 11 pm daily ☕", autoSend: false } });
  expect(created.ok()).toBe(true);
  const ruleId = (await created.json()).data.id as string;
  try {
    // Keyword replies waiting for approval are on the Keyword replies tab.
    await page.goto("/engagement/keywords");
    simulateComment(`${keyword}?`, `e2e_deleted_${RUN}`);
    await waitForItem(`${keyword}?`);
    const draft = item(`${keyword}?`);
    // Keyword replies use the rule's text: no Regenerate, and a comment reply is limited to 300 characters.
    await expect(draft.getByRole("button", { name: "Regenerate" })).toHaveCount(0);
    await draft.getByTestId("reply-text").click();
    await expect(draft.getByTestId("reply-counter")).toContainText("/300");
    await draft.getByTestId("reply-editor").fill("y".repeat(301));
    await expect(draft.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
    await draft.getByRole("button", { name: "Cancel" }).click();

    // The mock treats comment ids containing "deleted" as deleted on Instagram.
    await draft.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText("The comment was deleted on Instagram, so this reply can't be posted.")).toBeVisible();
    await expect(draft.getByTestId("reply-blocked")).toContainText("the comment was deleted on Instagram");
    await expect(draft.getByRole("button", { name: "Send", exact: true })).toHaveCount(0);
    const removed = page.waitForResponse((r) => r.url().includes("/dismiss") && r.request().method() === "POST");
    await draft.getByRole("button", { name: "Remove" }).click();
    await expect(draft).toBeHidden();
    expect((await removed).ok()).toBe(true);
    await page.reload();
    await expect(page.getByTestId("reply-queue")).toBeVisible();
    await expect(item(`${keyword}?`)).toHaveCount(0);
  } finally {
    await page.request.delete(`/api/engagement/rules/${ruleId}`);
    await page.goto("/engagement/messages");
  }
});

test("works in Arabic (RTL) and fits a phone screen", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  simulateDm(`مرحبا، هل عندكم توصيل؟ ${RUN}`, `e2e_ar_${RUN}`);
  await waitForItem(`توصيل؟ ${RUN}`);
  await switchLanguage(page, "ar");
  await expect(page.getByTestId("replies-tab-waiting")).toContainText("بانتظار الموافقة");
  const draft = item(`توصيل؟ ${RUN}`);
  await expect(draft.getByRole("button", { name: "إعادة الصياغة" })).toBeVisible();
  await expect(draft.getByRole("button", { name: "إرسال", exact: true })).toBeVisible();
  await draft.getByTestId("reply-text").click();
  await expect(draft.getByTestId("reply-counter")).toContainText("/1,000");
  await draft.getByRole("button", { name: "إلغاء" }).click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.goto("/engagement/settings");
  await expect(page.getByTestId("reply-summary")).toContainText("آخر");
  await switchLanguage(page, "en");
  await page.setViewportSize({ width: 1280, height: 800 });
});
