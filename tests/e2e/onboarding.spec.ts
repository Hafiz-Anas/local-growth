import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { startGeminiStub } from "./gemini-stub";

/**
 * The light onboarding, end to end (see playwright.config.ts for how to run). Four steps:
 * connect, confirm the AI-filled brand, goals, optional competitors.
 * - a new user finishes in well under 5 minutes, with the AI pre-fill (Gemini stub);
 * - no Instagram yet → the optional "few posts" fallback; "Finish later" keeps everything;
 * - AI unavailable → empty fields, onboarding carries on (Arabic, phone width);
 * - existing businesses get the one-time goals prompt.
 * Mock Instagram flow (INSTAGRAM_PROVIDER=mock). Signs up 3 accounts (5 per 15 min allowed).
 */

const RUN = randomUUID().slice(0, 6);
const PASSWORD = "Growth2026!";
const AR = JSON.parse(readFileSync(path.join(process.cwd(), "locales", "ar.json"), "utf8"));

test.describe.configure({ mode: "serial" });

let stub: Awaited<ReturnType<typeof startGeminiStub>>;

test.beforeAll(async () => {
  stub = await startGeminiStub();
});

test.afterAll(async () => {
  await stub.close();
});

async function signUp(page: Page, tag: string) {
  await page.goto("/signup");
  await page.getByLabel("Full name").fill(`Test Owner ${tag}`);
  await page.getByLabel("Email").fill(`onboard-${tag}-${RUN}@example.com`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Business name").fill(`Kuwait Bakes ${tag}`);
  await page.getByRole("button", { name: "Sign up" }).click();
  await page.waitForURL(/\/onboarding/);
}

async function connectMock(page: Page, tag: string, connectLabel = "Connect Instagram") {
  await page.locator("#ob-handle").fill(`kb${tag}${RUN}`);
  await page.getByRole("button", { name: connectLabel, exact: true }).click();
  await expect(page.locator("#ob-handle")).toHaveCount(0);
}

const progress = (page: Page) => page.getByRole("progressbar").locator("xpath=following-sibling::p");

test("a new user finishes onboarding in 4 light steps, well under 5 minutes, confirming what the AI filled in", async ({ page }) => {
  test.setTimeout(300_000);
  await signUp(page, "a");
  const started = Date.now();

  // 1 — Connect Instagram.
  await expect(progress(page)).toContainText("Step 1 of 4");
  await connectMock(page, "a");
  await page.getByRole("button", { name: "Continue" }).click();

  // 2 — Confirm your brand: filled in from the bio and recent posts.
  await expect(progress(page)).toContainText("Step 2 of 4");
  await expect(page.getByTestId("prefill-status")).toContainText("Filled in from your Instagram");
  await expect(page.getByLabel("Business name")).toHaveValue("Kuwait Bakes a");
  await expect(page.getByLabel("Niche / theme")).toHaveValue("Home bakery for celebration cakes");
  await expect(page.getByRole("radio", { name: "Bakery" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radio", { name: "Casual" })).toHaveAttribute("aria-checked", "true");
  // The account has posts: no "few posts" fallback.
  await expect(page.getByTestId("few-posts-fallback")).toHaveCount(0);
  const prefillCall = stub.calls.find((c) => c.kind === "prefill")!;
  expect(prefillCall.system).toContain("<recent_captions>");
  await page.getByRole("radio", { name: "Friendly" }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  // 3 — Goals: defaults are already picked; one tap to change the aim.
  await expect(progress(page)).toContainText("Step 3 of 4");
  await expect(page.getByRole("radio", { name: "More customers" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("checkbox", { name: "Post consistently" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("radio", { name: "More followers" }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  // 4 — Competitors are optional.
  await expect(progress(page)).toContainText("Step 4 of 4");
  await page.getByRole("button", { name: "Add later" }).click();
  await page.waitForURL(/\/dashboard/);
  const seconds = (Date.now() - started) / 1000;
  console.log(`[onboarding] 4 steps finished in ${seconds.toFixed(1)} s (automated, incl. the AI pre-fill)`);
  expect(seconds).toBeLessThan(300);

  // Saved where every AI call reads it.
  const goals = (await (await page.request.get("/api/brand/goals")).json()).data;
  expect(goals).toEqual({ niche: "Home bakery for celebration cakes", aim: "more_followers", goals: ["post_consistently", "grow_reach"], timeline: "3_months" });
  // Nothing needs competitors: the page works with none.
  await page.goto("/competitors");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("Something went wrong")).toHaveCount(0);
  // No one-time goals prompt for a business that just set its goals.
  await page.goto("/dashboard");
  await expect(page.getByTestId("goals-prompt")).toHaveCount(0);
});

test("no Instagram yet: the optional fallback; “Finish later” opens the app and keeps everything", async ({ page }) => {
  await signUp(page, "b");
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(progress(page)).toContainText("Step 2 of 4");
  await expect(page.getByTestId("prefill-status")).toContainText("Fill in what you like");
  await expect(page.getByTestId("few-posts-fallback")).toBeVisible();
  await page.getByLabel("Niche / theme").fill("Kunafa and sweets");
  await page.getByLabel("Example caption").fill("Warm kunafa, fresh out of the oven 🍯");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(progress(page)).toContainText("Step 3 of 4");

  await page.getByRole("button", { name: "Finish later" }).click();
  await page.waitForURL(/\/dashboard/);
  const card = page.getByTestId("finish-setup");
  await expect(card).toContainText("2 quick steps left");
  await card.getByRole("link", { name: "Continue setup" }).click();
  await page.waitForURL(/\/onboarding/);
  await expect(progress(page)).toContainText("Step 3 of 4");
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByLabel("Niche / theme")).toHaveValue("Kunafa and sweets");
  await expect(page.getByLabel("Example caption")).toHaveValue("Warm kunafa, fresh out of the oven 🍯");
});

test("AI unavailable: the fields stay empty and onboarding carries on — in Arabic, on a phone", async ({ browser }: { browser: Browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  stub.state.fail = true;
  try {
    await signUp(page, "c");
    await page.getByRole("button", { name: "Change language" }).first().click();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(progress(page)).toContainText("الخطوة 1 من 4");
    await connectMock(page, "c", AR.onboarding.instagram.connect);
    await page.getByRole("button", { name: AR.onboarding.continue }).click();
    await expect(page.getByTestId("prefill-status")).toContainText(AR.onboarding.brand.notFilled);
    await expect(page.getByLabel(AR.onboarding.brand.niche)).toHaveValue("");
    await page.getByRole("button", { name: AR.onboarding.continue }).click();
    await expect(progress(page)).toContainText("الخطوة 3 من 4");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
  } finally {
    stub.state.fail = false;
    await page.getByRole("button", { name: "تغيير اللغة" }).first().click().catch(() => {});
    await page.close();
  }
});

test("existing businesses get a one-time goals prompt (save or not now)", async ({ browser }) => {
  for (const [email, action] of [
    ["user@mathanetbaity.dev", "save"],
    ["cafe@localgrowth.dev", "dismiss"],
  ] as const) {
    const page = await browser.newPage();
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill("User@123");
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"));
    await page.goto("/dashboard");
    const prompt = page.getByTestId("goals-prompt");
    await expect(prompt).toBeVisible();
    if (action === "save") {
      await prompt.getByLabel("Niche / theme").fill("Nuts and coffee roastery");
      await prompt.getByRole("checkbox", { name: "Promote offers" }).click();
      await prompt.getByRole("button", { name: "Save" }).click();
    } else {
      await prompt.getByRole("button", { name: "Not now" }).first().click();
    }
    await expect(prompt).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("goals-prompt")).toHaveCount(0);
    if (action === "save") {
      const goals = (await (await page.request.get("/api/brand/goals")).json()).data;
      expect(goals.niche).toBe("Nuts and coffee roastery");
      expect(goals.goals).toContain("promote_offers");
      await page.goto("/settings");
      await expect(page.getByLabel("Niche / theme")).toHaveValue("Nuts and coffee roastery");
    }
    await page.close();
  }
});
