import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";

/**
 * Keyword replies, end to end (see playwright.config.ts for how to run): the rules UI
 * (create, edit, pause, delete, EN/AR), real triggers through `npm run simulate-comment`
 * (signed webhook → match → reply, dedupe, cooldown, approval queue) and the admin
 * feature toggle. Uses the seeded "Dalla & Bean" demo business (mock Instagram connection).
 */

const USER = { email: "cafe@localgrowth.dev", password: "User@123" };
const ADMIN = { email: "admin@localgrowth.dev", password: "Admin@123" };
const HANDLE = "dallabean.kw";
const RUN = randomUUID().slice(0, 6);
const KEYWORD = `MENU${RUN}`;

test.describe.configure({ mode: "serial" });

let page: Page;

async function login(p: Page, account: { email: string; password: string }) {
  await p.goto("/login");
  await p.getByLabel("Email").fill(account.email);
  await p.getByLabel("Password", { exact: true }).fill(account.password);
  await p.getByRole("button", { name: "Log in" }).click();
  await p.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/** Posts a signed "comments" webhook through the simulate script, like Meta would. */
function simulateComment(text: string, options: { from?: string; commentId?: string } = {}) {
  const args = ["--import", "tsx", path.join("scripts", "simulate-comment.ts"), "--handle", HANDLE, "--text", text, "--url", test.info().project.use.baseURL!];
  if (options.from) args.push("--from", options.from);
  if (options.commentId) args.push("--comment-id", options.commentId);
  execFileSync(process.execPath, args, { stdio: "pipe", env: process.env });
}

const ruleItem = (p: Page) => p.getByTestId("keyword-rule").filter({ hasText: KEYWORD });

async function expectTriggered(p: Page, item: () => Locator, count: number) {
  // The webhook does its work after answering, so give it a moment.
  await expect(async () => {
    await p.reload();
    await expect(item()).toContainText(`Triggered ${count} times`, { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
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

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await browser.newPage();
  await login(page, USER);
  // Start in English even if an earlier run left the account in Arabic.
  if ((await page.locator("html").getAttribute("dir")) === "rtl") await switchLanguage(page, "en");
});

test.afterAll(async () => {
  await page.close();
});

test("lists the business's keyword replies on their own tab, with what the tab does and its status", async () => {
  await page.goto("/engagement/keywords");
  await expect(page.getByRole("heading", { name: "Keyword replies" })).toBeVisible();
  await expect(page.getByText("When a comment contains a word you choose")).toBeVisible();
  await expect(page.getByTestId("automation-status")).toContainText("Active rules:");
  await expect(page.getByTestId("keyword-rule").first()).toBeVisible();
});

test("creates a rule (save stays off until keywords and a public reply are filled)", async () => {
  await page.getByRole("button", { name: "New rule" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "New keyword reply" })).toBeVisible();
  const save = dialog.getByRole("button", { name: "Save" });
  await expect(save).toBeDisabled();

  await dialog.getByLabel("Keywords").fill(`${KEYWORD}, منيو${RUN}`);
  await expect(save).toBeDisabled();
  await dialog.getByRole("radio", { name: "Exact comment" }).click();
  await dialog.getByLabel("Public reply").fill("Sent you the menu in a DM 📩");
  await dialog.getByLabel("Private DM (optional)").fill("Here's our full menu: dallabean.cafe/menu");
  await expect(save).toBeEnabled();
  await save.click();
  await expect(dialog).toBeHidden();

  const item = ruleItem(page);
  await expect(item).toBeVisible();
  await expect(item).toContainText(`منيو${RUN}`);
  await expect(item).toContainText("Exact comment");
  await expect(item).toContainText("Sends automatically");
  await expect(item).toContainText("Not triggered yet");
  await expect(item).toContainText("Here's our full menu");
});

test("a matching comment triggers it once: no second reply for the same comment or within the cooldown", async () => {
  const commentId = `e2e_${randomUUID()}`;
  simulateComment(`${KEYWORD.toLowerCase()}!!! 😍`, { from: `e2e_${RUN}`, commentId });
  await expectTriggered(page, () => ruleItem(page), 1);
  await expect(ruleItem(page)).not.toContainText("Not triggered yet");

  // Meta retrying the same delivery, the same person again, and the business's own comment.
  simulateComment(KEYWORD, { from: `e2e_${RUN}`, commentId });
  simulateComment(KEYWORD, { from: `e2e_${RUN}` });
  simulateComment(KEYWORD, { from: HANDLE });
  // A comment that only contains the keyword doesn't match an "exact" rule.
  simulateComment(`what's on the ${KEYWORD}?`, { from: `e2e_other_${RUN}` });
  await page.waitForTimeout(3_000);
  await page.reload();
  await expect(ruleItem(page)).toContainText("Triggered 1 times");
});

test("edits a rule to need approval; its reply then waits in the queue and posts on approval", async () => {
  await ruleItem(page).getByRole("button", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Edit keyword reply" })).toBeVisible();
  await dialog.getByLabel("Public reply").fill("Menu sent to your DMs ✨");
  await dialog.getByRole("switch", { name: /Send automatically/ }).click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(ruleItem(page)).toContainText("Needs approval");
  await expect(ruleItem(page)).toContainText("Menu sent to your DMs ✨");

  // Arabic keyword with diacritics and emoji still matches.
  simulateComment(`مِنيو${RUN} 🙏`, { from: `e2e_ar_${RUN}` });
  await expectTriggered(page, () => ruleItem(page), 2);
  const draft = page.locator("li").filter({ hasText: `مِنيو${RUN}` }).filter({ hasText: "Keyword reply" });
  await expect(draft).toBeVisible();
  await expect(draft).toContainText("Also sends this private DM:");
  await draft.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("Reply posted")).toBeVisible();
  await expect(draft).toBeHidden();
});

test("pauses and resumes a rule", async () => {
  await ruleItem(page).getByRole("switch", { name: "Pause" }).click();
  await expect(ruleItem(page)).toContainText("Paused");
  await page.reload();
  await expect(ruleItem(page)).toContainText("Paused");
  await ruleItem(page).getByRole("switch", { name: "Resume" }).click();
  await expect(ruleItem(page)).toContainText("Active");
});

test("shows the section in Arabic, right to left", async () => {
  await switchLanguage(page, "ar");
  await expect(page.getByRole("heading", { name: "الردود بالكلمات المفتاحية" })).toBeVisible();
  await expect(ruleItem(page)).toContainText("تحتاج موافقة");
  await page.getByRole("button", { name: "قاعدة جديدة" }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "رد جديد بالكلمات المفتاحية" })).toBeVisible();
  await expect(page.getByRole("dialog").getByLabel("الرد العام")).toBeVisible();
  await page.keyboard.press("Escape");
  await switchLanguage(page, "en");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
});

test("deletes a rule after confirming", async () => {
  await ruleItem(page).getByRole("button", { name: "Delete rule" }).click();
  const confirm = page.getByRole("dialog");
  await expect(confirm).toContainText("Delete this rule?");
  await confirm.getByRole("button", { name: "Delete rule" }).click();
  await expect(ruleItem(page)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Keyword replies" })).toBeVisible();
  await expect(ruleItem(page)).toHaveCount(0);
});

test("is removed (not grayed out) when the admin turns the feature off", async ({ browser }) => {
  const adminPage = await browser.newPage();
  await login(adminPage, ADMIN);
  const list = await adminPage.request.get(`/api/admin/businesses?q=${HANDLE}`);
  const businesses = (await list.json()).data as Array<{ id: string }>;
  expect(businesses).toHaveLength(1);
  const setFeature = (on: boolean) => adminPage.request.patch(`/api/admin/businesses/${businesses[0].id}/permissions`, { data: { changes: { "engagement.dmRules": on } } });

  try {
    expect((await setFeature(false)).ok()).toBe(true);
    await page.goto("/engagement");
    await expect(page).toHaveURL(/\/engagement\/comments$/);
    await expect(page.getByTestId("section-tabs")).toBeVisible();
    await expect(page.getByTestId("section-tabs").getByRole("link", { name: "Keyword replies" })).toHaveCount(0);
    await expect(page.getByTestId("keyword-rule")).toHaveCount(0);
    expect((await page.request.get("/api/engagement/rules")).status()).toBe(404);
    // The tab's own URL is gone too (not-found), never grayed out.
    await page.goto("/engagement/keywords");
    await expect(page.getByRole("heading", { name: "Keyword replies" })).toHaveCount(0);
  } finally {
    await setFeature(true);
    await adminPage.close();
  }
  await page.goto("/engagement/keywords");
  await expect(page.getByRole("heading", { name: "Keyword replies" })).toBeVisible();
});
