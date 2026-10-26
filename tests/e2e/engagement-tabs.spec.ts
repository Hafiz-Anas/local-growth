import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * Engagement's tabs (config/navigation.ts): Comment replies · DM replies · Keyword replies · Reply
 * settings, each with a one-line description, an intro sentence and the on/off status of its
 * automation; old /engagement links open the first tab; every card is in exactly one tab; Arabic
 * (RTL) and phone width. Uses the seeded "Dalla & Bean" business (mock Instagram, connected).
 */

const USER = { email: "cafe@localgrowth.dev", password: "User@123" };

const TABS = [
  { href: "/engagement/comments", label: "Comment replies", hint: "Answer comments on posts", intro: "When someone comments on your posts" },
  { href: "/engagement/messages", label: "DM replies", hint: "Answer your messages", intro: "When a customer sends you a message" },
  { href: "/engagement/keywords", label: "Keyword replies", hint: "Reply when words appear", intro: "When a comment contains a word you choose" },
  { href: "/engagement/settings", label: "Reply settings", hint: "Approval and AI results", intro: "Choose whether AI replies wait for you" },
];

test.describe.configure({ mode: "serial" });

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
  await p.getByTestId("profile-menu-trigger").click();
  await p.getByTestId("menu-language").click();
  await expect(p.locator("html")).toHaveAttribute("dir", to === "ar" ? "rtl" : "ltr");
  await saved;
}

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await browser.newPage();
  await login(page, USER);
  if ((await page.locator("html").getAttribute("dir")) === "rtl") await switchLanguage(page, "en");
});

test.afterAll(async () => {
  await page.close();
});

test("old /engagement links open Comment replies, the most-used tab", async () => {
  await page.goto("/engagement");
  await expect(page).toHaveURL(/\/engagement\/comments$/);
  const current = page.getByTestId("section-tabs").getByRole("link", { name: "Comment replies" });
  await expect(current).toHaveAttribute("aria-current", "page");
});

test("shows four tabs, each with its description, intro sentence and automation status", async () => {
  const tabs = page.getByTestId("section-tabs");
  await expect(tabs.getByTestId("section-tab-label")).toHaveText(TABS.map((tab) => tab.label));
  for (const tab of TABS) {
    await tabs.getByRole("link", { name: tab.label }).click();
    await expect(page).toHaveURL(new RegExp(`${tab.href}$`));
    await expect(tabs.getByRole("link", { name: tab.label })).toContainText(tab.hint);
    await expect(page.getByRole("heading", { level: 1, name: tab.label })).toBeVisible();
    await expect(page.getByText(tab.intro)).toBeVisible();
    await expect(page.getByTestId("automation-status")).toBeVisible();
  }
});

test("every section lives in exactly one tab", async () => {
  // [reply queue, keyword rules, as-is summary, approval switch] expected on each tab.
  const expected: Record<string, [number, number, number, number]> = {
    "/engagement/comments": [1, 0, 0, 0],
    "/engagement/messages": [1, 0, 0, 0],
    "/engagement/keywords": [0, 1, 0, 0],
    "/engagement/settings": [0, 0, 1, 1],
  };
  for (const [href, [queue, rules, summary, approval]] of Object.entries(expected)) {
    await page.goto(href);
    await expect(page.getByTestId("automation-status")).toBeVisible();
    // Keyword replies add an approval queue only while a rule needs approval, so it isn't counted there.
    if (href !== "/engagement/keywords") await expect(page.getByTestId("reply-queue"), href).toHaveCount(queue);
    await expect(page.getByText("Your rules", { exact: true }), href).toHaveCount(rules);
    await expect(page.getByTestId("reply-summary"), href).toHaveCount(summary);
    await expect(page.getByRole("switch", { name: /Manual approval/ }), href).toHaveCount(approval);
  }
  // Auto-reply stays hidden until auto-sending works (config/engagement.ts): approval is always on.
  await expect(page.getByRole("switch", { name: /Auto-reply/ })).toHaveCount(0);
  await expect(page.getByRole("switch", { name: /Manual approval/ })).toBeChecked();

  // The comment tab only lists replies to comments, the DM tab only DMs.
  await page.goto("/engagement/comments");
  await expect(page.getByTestId("reply-item").getByText("Direct message", { exact: true })).toHaveCount(0);
  await page.goto("/engagement/messages");
  await expect(page.getByTestId("reply-item").getByText("Keyword reply")).toHaveCount(0);
});

test("works in Arabic (RTL) and fits a phone screen", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/engagement/comments");
  await switchLanguage(page, "ar");
  const tabs = page.getByTestId("section-tabs");
  await expect(tabs.getByTestId("section-tab-label")).toHaveText(["الرد على التعليقات", "الرد على الرسائل", "الردود بالكلمات", "إعدادات الرد"]);
  await expect(page.getByTestId("automation-status")).toContainText("مفعّل");
  for (const href of TABS.map((tab) => tab.href)) {
    await page.goto(href);
    await expect(page.getByTestId("automation-status")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, href).toBeLessThanOrEqual(0);
  }
  await switchLanguage(page, "en");
  await page.setViewportSize({ width: 1280, height: 800 });
});
