import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import sharp from "sharp";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { startGeminiStub } from "./gemini-stub";

/**
 * Sign-up and the five-step onboarding, end to end (see playwright.config.ts for how to run):
 * - sign-up asks only for email and password, then connects Instagram, which names the business;
 *   until it's connected every page leads back to that screen;
 * - the five steps with the AI pre-fill, picked posts + an upload for the style guide, goals,
 *   location and AI-suggested competitors, then "You're all set" → Home; the answers reach the AI;
 * - every step can be skipped, and "Finish later" keeps the place;
 * - AI unavailable → empty fields, onboarding carries on (Arabic, phone width);
 * - existing clients get a one-time prompt for the new steps, and the goals prompt still works.
 * Mock Instagram flow, Gemini stub. Signs up 3 accounts (5 per 15 min allowed). The last two tests
 * adjust prompt dates of their businesses directly in the e2e database (DATABASE_URL), so they don't
 * need a fresh seed.
 */

const RUN = randomUUID().slice(0, 6);
const PASSWORD = "Growth2026!";
const AR = JSON.parse(readFileSync(path.join(process.cwd(), "locales", "ar.json"), "utf8"));
const email = (tag: string) => `onboard-${tag}-${RUN}@example.com`;
const handle = (tag: string) => `kbakes_${tag}_${RUN}`;

test.describe.configure({ mode: "serial" });

let stub: Awaited<ReturnType<typeof startGeminiStub>>;
let pool: Pool;

test.beforeAll(async () => {
  stub = await startGeminiStub();
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) throw new Error("Set DATABASE_URL to the local e2e database.");
  pool = new Pool({ connectionString: url.replace(/\?.*$/, "") });
});

test.afterAll(async () => {
  await stub.close();
  await pool.end();
});

/** The business of a login (its active Instagram account). */
const businessOf = async (login: string) => (await pool.query<{ businessId: string }>(`SELECT "businessId" FROM "User" WHERE email = $1`, [login])).rows[0].businessId;

async function signUp(page: Page, tag: string) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email(tag));
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign up" }).click();
  await page.waitForURL(/\/signup\/instagram/);
}

async function connectMock(page: Page, tag: string, connectLabel = "Connect Instagram") {
  await page.locator("#ob-handle").fill(handle(tag));
  await page.getByRole("button", { name: connectLabel, exact: true }).click();
  await page.waitForURL(/\/onboarding/);
}

async function logIn(page: Page, login: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(login);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

const step = (page: Page) => page.getByTestId("wizard-step");
const api = async (page: Page, url: string) => (await (await page.request.get(url)).json()).data;

test("sign-up asks for email and password, connects Instagram, and the five steps reach the AI", async ({ page }) => {
  test.setTimeout(300_000);

  // Sign-up, step 1 of 2: email and password only.
  await page.goto("/signup");
  await expect(page.getByTestId("signup-step")).toContainText("Step 1 of 2");
  await expect(page.getByLabel("Full name")).toHaveCount(0);
  await expect(page.getByLabel("Business name")).toHaveCount(0);
  await signUp(page, "a");
  const started = Date.now();

  // Step 2 of 2: connect Instagram. Until then, every page leads back here.
  await expect(page.getByTestId("signup-step")).toContainText("Step 2 of 2");
  for (const url of ["/dashboard", "/onboarding", "/settings"]) {
    await page.goto(url);
    await expect(page).toHaveURL(/\/signup\/instagram/);
  }
  await connectMock(page, "a");

  // 1 — Your business: filled in from the bio and recent posts.
  await expect(step(page)).toContainText("Step 1 of 5 · Your business");
  await expect(page.getByTestId("prefill-status")).toContainText("Filled in from your Instagram");
  await expect(page.getByRole("radio", { name: "Bakery" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radio", { name: "Casual" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("button", { name: "Remove Cakes" })).toBeVisible();
  expect(stub.calls.find((c) => c.kind === "prefill")!.system).toContain("<recent_captions>");
  await page.getByRole("radio", { name: "Friendly" }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  // 2 — Your style: two posts from the grid and a photo from the phone.
  await expect(step(page)).toContainText("Step 2 of 5 · Your style");
  const grid = page.getByTestId("style-grid").getByRole("button");
  await grid.nth(0).click();
  await grid.nth(1).click();
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#c98b4a" } }).png().toBuffer();
  await page.getByTestId("style-file-input").setInputFiles({ name: "cake.png", mimeType: "image/png", buffer: png });
  await expect(page.getByTestId("style-count")).toHaveText("3 of 5 picked");
  await page.getByRole("button", { name: "Continue" }).click();

  // 3 — Your goals.
  await expect(step(page)).toContainText("Step 3 of 5 · Goals");
  await page.getByRole("checkbox", { name: "Sales" }).click();
  await page.getByRole("checkbox", { name: "Followers" }).click();
  await page.getByLabel("Followers: how many more? (optional)").fill("500");
  await page.getByRole("checkbox", { name: "Tempting" }).click();
  await page.getByRole("checkbox", { name: "Other" }).click();
  await page.getByLabel("Your own word").fill("cosy");
  await page.getByRole("button", { name: "Continue" }).click();

  // 4 — Your location.
  await expect(step(page)).toContainText("Step 4 of 5 · Location");
  await page.getByRole("radio", { name: "Hawalli" }).click();
  await page.getByLabel("Area").selectOption("salmiya");
  await page.getByRole("radio", { name: "Both" }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  // 5 — Competitors: the AI's suggestions, checked with Instagram (the private one is dropped).
  await expect(step(page)).toContainText("Step 5 of 5 · Competitors");
  const suggestions = page.getByTestId("competitor-suggestions");
  await expect(suggestions).toContainText("@salmiya.sweets");
  await expect(suggestions).toContainText("@hawalli.bakery");
  await expect(suggestions).not.toContainText("private_cakeclub");
  expect(stub.calls.find((c) => c.kind === "suggest")!.system).toContain("Location: Salmiya, Hawalli");
  await page.getByRole("button", { name: "Add @salmiya.sweets" }).click();
  await expect(page.getByText("1 ready to compare")).toBeVisible();
  await page.getByRole("button", { name: "Finish", exact: true }).click();

  // You're all set: the style line arrives once the background analysis is done.
  await expect(page.getByTestId("all-set")).toContainText("You're all set");
  await expect(page.locator("#style-summary")).toHaveValue("Warm colors, close-up, top-down angle", { timeout: 30_000 });
  expect(stub.state.styleImages).toBe(3);
  const seconds = (Date.now() - started) / 1000;
  console.log(`[onboarding] sign-up + 5 steps finished in ${seconds.toFixed(1)} s (automated)`);
  expect(seconds).toBeLessThan(120);
  await page.getByRole("link", { name: "Go to Home" }).click();
  await page.waitForURL(/\/dashboard/);
  for (const prompt of ["new-steps-prompt", "goals-prompt", "finish-setup"]) await expect(page.getByTestId(prompt)).toHaveCount(0);

  // Saved, and the business is named after the Instagram account.
  const goals = await api(page, "/api/brand/goals");
  expect(goals.targets).toEqual([{ key: "sales", number: null }, { key: "followers", number: 500 }]);
  expect(goals.feelings).toEqual(["tempting"]);
  expect(goals.feelingOther).toBe("cosy");
  const details = await api(page, "/api/brand/business");
  expect(details).toMatchObject({ name: `Kbakes A ${RUN.charAt(0).toUpperCase()}${RUN.slice(1)}`, governorate: "hawalli", area: "salmiya", serviceMode: "both" });
  expect(details.products).toContain("Cakes");

  // Every answer reaches the AI's data block (here: the assistant).
  const asked = await page.request.post("/api/assistant/messages", { data: { mode: "post", text: "What should I post this week?" } });
  expect(asked.status()).toBe(201);
  const data = stub.calls.find((c) => c.kind === "chat" && c.turns.at(-1)?.text.includes("What should I post this week?"))!.system;
  for (const line of ["Photo style: Warm colors, close-up, top-down angle", "Location: Salmiya, Hawalli, Kuwait", "Wants: more sales, more followers (target: 500)", "Posts should feel: tempting (makes people want it now), cosy", "Cakes"]) {
    expect(data).toContain(line);
  }

  // Settings lets them change it all.
  await page.goto("/settings");
  await expect(page.locator("#business-name")).toHaveValue(details.name);
  await expect(page.getByLabel("Area")).toHaveValue("salmiya");
  await expect(page.locator("#style-summary")).toHaveValue("Warm colors, close-up, top-down angle");
  await expect(page.locator("#target-followers")).toHaveValue("500");
  await page.locator("#business-name").fill("Kuwait Bakes Salmiya");
  await page.getByRole("radio", { name: "Delivery only" }).click();
  await page.locator("#business").getByRole("button", { name: "Save" }).first().click();
  await expect(page.getByText("Business details saved")).toBeVisible();
  await page.locator("#style-summary").fill("Bright pastels, eye level");
  await page.locator("#business").getByTestId("style-summary").getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Photo style saved")).toBeVisible();
  await page.reload();
  await expect(page.locator("#business-name")).toHaveValue("Kuwait Bakes Salmiya");
  await expect(page.getByRole("radio", { name: "Delivery only" })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("#style-summary")).toHaveValue("Bright pastels, eye level");
});

test("every step can be skipped, and “Finish later” keeps the place", async ({ page }) => {
  test.setTimeout(180_000);
  await signUp(page, "b");
  await connectMock(page, "b");

  await expect(step(page)).toContainText("Step 1 of 5");
  await page.getByTestId("skip-step").click();
  await expect(step(page)).toContainText("Step 2 of 5");
  await page.getByTestId("skip-step").click();
  await expect(step(page)).toContainText("Step 3 of 5");

  await page.getByRole("button", { name: "Finish later" }).click();
  await page.waitForURL(/\/dashboard/);
  const card = page.getByTestId("finish-setup");
  await expect(card).toContainText("3 quick steps left");
  await card.getByRole("link", { name: "Continue setup" }).click();
  await page.waitForURL(/\/onboarding/);
  await expect(step(page)).toContainText("Step 3 of 5");

  await page.getByTestId("skip-step").click();
  await expect(step(page)).toContainText("Step 4 of 5");
  await page.getByTestId("skip-step").click();
  await expect(step(page)).toContainText("Step 5 of 5");
  await page.getByTestId("skip-step").click();
  await expect(page.getByTestId("all-set")).toBeVisible();
  await page.getByRole("link", { name: "Go to Home" }).click();
  await page.waitForURL(/\/dashboard/);
  await expect(page.getByTestId("finish-setup")).toHaveCount(0);

  // Nothing was saved from the skipped steps…
  const goals = await api(page, "/api/brand/goals");
  expect(goals).toMatchObject({ targets: [], feelings: [], feelingOther: null });
  expect(await api(page, "/api/brand/business")).toMatchObject({ governorate: null, area: null, serviceMode: null, products: [] });
  // …and "Your style" skipped → the style guide comes from the most recent posts.
  await expect
    .poll(async () => (await api(page, "/api/brand/style"))?.status, { timeout: 30_000 })
    .toBe("ready");
  expect(await api(page, "/api/brand/style")).toMatchObject({ basis: "recent", summary: "Warm colors, close-up, top-down angle" });
});

test("AI unavailable: the fields stay empty and onboarding carries on — in Arabic, on a phone", async ({ browser }: { browser: Browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  stub.state.fail = true;
  try {
    await signUp(page, "c");
    await page.getByRole("button", { name: "Change language" }).first().click();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByTestId("signup-step")).toContainText("الخطوة 2 من 2");
    await connectMock(page, "c", AR.onboarding.instagram.connect);

    await expect(step(page)).toContainText(`الخطوة 1 من 5 · ${AR.onboarding.steps.business.short}`);
    await expect(page.getByTestId("prefill-status")).toContainText(AR.onboarding.brand.notFilled);
    await expect(page.getByRole("radio", { name: AR.businessTypes.bakery })).toHaveAttribute("aria-checked", "false");
    for (let n = 2; n <= 5; n++) {
      await page.getByRole("button", { name: AR.onboarding.continue }).click();
      await expect(step(page)).toContainText(`الخطوة ${n} من 5`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBe(0);
    }
    await expect(page.getByTestId("competitor-suggestions")).toContainText(AR.onboarding.competitors.suggestionsUnavailable);
    await page.getByRole("button", { name: AR.onboarding.finish, exact: true }).click();
    await expect(page.getByTestId("all-set")).toContainText(AR.onboarding.allSet.title);
  } finally {
    stub.state.fail = false;
    await page.getByRole("button", { name: "تغيير اللغة" }).first().click().catch(() => {});
    await page.close();
  }
});

test("existing clients get a one-time prompt for the new steps: skip it, or answer them", async ({ browser }) => {
  test.setTimeout(180_000);
  // Businesses that finished before the five-step wizard (as the migration leaves them).
  const [a, b] = [await businessOf(email("a")), await businessOf(email("b"))];
  await pool.query(`UPDATE "Business" SET "setupPromptDoneAt" = NULL WHERE id = ANY($1)`, [[a, b]]);

  const first = await browser.newPage();
  await logIn(first, email("a"));
  await first.goto("/dashboard");
  const prompt = first.getByTestId("new-steps-prompt");
  await expect(prompt).toContainText("Help your AI know you better");
  await prompt.getByRole("button", { name: "Skip" }).click();
  await expect(prompt).toHaveCount(0);
  await first.reload();
  await expect(first.getByTestId("new-steps-prompt")).toHaveCount(0);
  await first.close();

  const second = await browser.newPage();
  await logIn(second, email("b"));
  await second.goto("/dashboard");
  await second.getByTestId("new-steps-prompt").getByRole("button", { name: "Answer now" }).click();
  await second.waitForURL(/\/onboarding/);
  await expect(step(second)).toContainText("Step 1 of 5");
  await second.getByTestId("skip-step").click();
  await second.getByTestId("skip-step").click();
  await expect(step(second)).toContainText("Step 3 of 5");
  await second.getByRole("checkbox", { name: "Messages" }).click();
  await second.getByRole("button", { name: "Continue" }).click();
  await expect(step(second)).toContainText("Step 4 of 5");
  // The app stays open meanwhile; the dashboard links back instead of prompting again.
  await second.getByRole("button", { name: "Finish later" }).click();
  await second.waitForURL(/\/dashboard/);
  await expect(second.getByTestId("finish-setup")).toBeVisible();
  await expect(second.getByTestId("new-steps-prompt")).toHaveCount(0);
  expect((await api(second, "/api/brand/goals")).targets).toEqual([{ key: "messages", number: null }]);
  await second.close();
});

test("existing businesses still get the one-time goals prompt (save or not now)", async ({ browser }) => {
  for (const [login, action] of [
    ["user@mathanetbaity.dev", "save"],
    ["cafe@localgrowth.dev", "dismiss"],
  ] as const) {
    // Past the new-steps prompt, goals never set (as on a fresh seed).
    await pool.query(`UPDATE "Business" SET "setupPromptDoneAt" = now(), "goalsPromptDoneAt" = NULL, aim = NULL WHERE id = $1`, [await businessOf(login)]);
    const page = await browser.newPage();
    await logIn(page, login, "User@123");
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
      const goals = await api(page, "/api/brand/goals");
      expect(goals.niche).toBe("Nuts and coffee roastery");
      expect(goals.goals).toContain("promote_offers");
      await page.goto("/settings");
      await expect(page.getByLabel("Niche / theme")).toHaveValue("Nuts and coffee roastery");
    }
    await page.close();
  }
});
