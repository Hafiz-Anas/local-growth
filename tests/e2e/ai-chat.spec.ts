import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * The AI chat (components/ai-chat, copied from the design proposal), in mock mode: the centre AI tab,
 * modes and their suggested questions, the proposal's mock answers (chart, photo link, estimate),
 * gallery photos attached inside the chat, the post card's actions, no footer banner (the AI tab is the way in),
 * typed questions (POST /api/ai-chat; stubbed here so the result doesn't depend on the AI provider),
 * and the feature switches. Nothing is saved: a page load starts over.
 */

const USER = { email: "user@mathanetbaity.dev", password: "User@123" };
const ADMIN = { email: "admin@localgrowth.dev", password: "Admin@123" };

// Long flows (the chat's animated steps, toasts that cover the top of the page for a few seconds).
test.describe.configure({ mode: "serial", timeout: 120_000 });

async function login(p: Page, account = USER) {
  await p.goto("/login");
  await p.getByLabel("Email").fill(account.email);
  await p.getByLabel("Password", { exact: true }).fill(account.password);
  await p.getByRole("button", { name: "Log in" }).click();
  await p.waitForURL((url) => !url.pathname.startsWith("/login"));
}

let page: Page;
const composer = () => page.getByRole("textbox", { name: "Ask anything…" });
const toast = (text: string | RegExp) => page.locator("[data-sonner-toast]").filter({ hasText: text });
const mode = (name: string) => page.getByRole("button", { name, exact: true });

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await browser.newPage({ viewport: { width: 1366, height: 860 } });
  await login(page);
});
test.afterAll(async () => page.close());

test("the centre AI tab opens the full ChatGPT-style chat with modes and suggested questions", async () => {
  await page.getByTestId("sidebar").getByRole("link", { name: "AI", exact: true }).click();
  await page.waitForURL(/\/ai$/);
  await expect(page.getByTestId("sidebar").getByRole("link", { name: "AI", exact: true })).toHaveAttribute("aria-current", "page");
  // Past chats in a column on desktop, seeded from the sample data.
  await expect(page.getByRole("navigation", { name: "Chats" })).toBeVisible();
  await page.getByRole("button", { name: "New chat" }).first().click();
  await expect(page.getByRole("heading", { name: "What shall we post today?" })).toBeVisible();
  for (const prompt of ["Create a post from a photo", "Combine photos into a new one", "Make a post like this", "What should I post tomorrow?", "Which hashtags should I use?"])
    await expect(page.getByRole("button", { name: prompt }).last()).toBeVisible();
  await mode("Analytics").click();
  for (const prompt of ["How did my reach change this week?", "Which post did best this month?", "When should I post?"]) await expect(page.getByRole("button", { name: prompt }).last()).toBeVisible();
  await mode("Competitors").click();
  for (const prompt of ["How do I compare with my competitors?", "What is working for them?", "Who is growing fastest?"]) await expect(page.getByRole("button", { name: prompt }).last()).toBeVisible();
  // No footer banner anywhere.
  await expect(page.getByTestId("ai-banner")).toHaveCount(0);
});

test("mock answers from the sample data: a chart, a photo link and an AI estimate", async () => {
  await mode("Competitors").click();
  await page.getByRole("button", { name: "Who is growing fastest?" }).last().click();
  await expect(page.getByText(/is growing fastest: \+/)).toBeVisible();
  await expect(page.getByText("AI estimate")).toBeVisible();

  await page.getByRole("button", { name: "New chat" }).first().click();
  await mode("Analytics").click();
  await page.getByRole("button", { name: "How did my reach change this week?" }).last().click();
  await expect(page.getByText(/^Your posts reached .* accounts this week/)).toBeVisible();
  await expect(page.locator("[aria-label^=\"Sat: \"]").first()).toBeVisible();
  // Suggested questions stay above the composer once chatting.
  await page.getByRole("button", { name: "Which post did best this month?" }).last().click();
  await expect(page.getByText(/^Your best post this month is/)).toBeVisible();
  await page.getByText(/^Your best post this month is/).locator("xpath=../..").getByRole("button").last().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
});

test("photos picked from the gallery inside the chat become a post card with every action", async () => {
  await page.getByRole("button", { name: "New chat" }).first().click();
  await page.getByRole("button", { name: "Attach photos" }).click();
  // Titled "Attach photos", then the open album's name.
  const picker = page.getByRole("dialog").last();
  await expect(picker.getByRole("heading", { name: "Attach photos" })).toBeVisible();
  await expect(picker.getByRole("tab", { name: "Library" })).toBeVisible();
  await picker.getByRole("tab", { name: "Albums" }).click();
  await picker.getByRole("button", { name: /^Sweets/ }).click();
  await picker.locator("button[aria-pressed]").first().click();
  await picker.getByRole("button", { name: "Attach (1)" }).click();
  await expect(composer()).toHaveValue("Create a post from this photo");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(/from your Sweets album\./)).toBeVisible({ timeout: 20_000 });

  // The newest post card (its buttons change while editing, so don't find it by one of them).
  const card = page.locator("article").last();
  await expect(card.getByRole("button", { name: "Approve and schedule" })).toBeVisible();
  for (const action of ["Post now", "Edit", "Regenerate", "Save to gallery"]) await expect(card.getByRole("button", { name: action })).toBeVisible();
  // Regenerate: Shorter / More formal / Friendlier rewrite the caption.
  const caption = card.locator("p[lang]").first();
  const before = await caption.innerText();
  await card.getByRole("button", { name: "Regenerate" }).click();
  for (const tone of ["Shorter", "More formal", "Friendlier"]) await expect(card.getByRole("button", { name: tone })).toBeVisible();
  await card.getByRole("button", { name: "Shorter" }).click();
  await expect(caption).not.toHaveText(before);
  // Edit the caption.
  await card.getByRole("button", { name: "Edit" }).click();
  await card.getByRole("textbox", { name: "Caption" }).fill("Fresh lugaimat today!");
  await card.getByRole("button", { name: "Save" }).click();
  await expect(card.getByText("Fresh lugaimat today!")).toBeVisible();
  await expect(card.getByText("Edited")).toBeVisible();
  // Post now (mock: marks it published in the gallery; nothing goes to Instagram).
  await card.getByRole("button", { name: "Post now" }).click();
  await expect(toast("Posted")).toBeVisible();
  await expect(card.getByRole("status")).toBeVisible();
});

test("typed questions: the AI's short reply when it answers, the proposal's sample answer otherwise", async () => {
  await page.getByRole("button", { name: "New chat" }).first().click();
  await mode("Analytics").click();
  await page.route("**/api/ai-chat", (route) => route.fulfill({ json: { ok: true, data: { text: "Post when your followers are online." } } }));
  await composer().fill("Tell me something useful");
  await composer().press("Enter");
  await expect(page.getByText("Post when your followers are online.")).toBeVisible();

  // AI off or over budget → the mode's sample answer (Analytics: reach this week).
  await page.route("**/api/ai-chat", (route) => route.fulfill({ json: { ok: true, data: { text: null } } }));
  await composer().fill("Anything else?");
  await composer().press("Enter");
  await expect(page.getByText(/^Your posts reached .* accounts this week/)).toBeVisible();
  await page.unroute("**/api/ai-chat");

  // A question its keywords match never leaves the browser.
  let called = false;
  await page.route("**/api/ai-chat", (route) => ((called = true), route.continue()));
  await composer().fill("Which hashtags work?");
  await composer().press("Enter");
  await expect(page.getByText(/^Use 5 to 8 hashtags/)).toBeVisible();
  expect(called).toBe(false);
  await page.unroute("**/api/ai-chat");
});

test("no footer banner on any page: the AI tab is the only way into the chat", async () => {
  for (const section of ["Gallery", "Engagement", "Insights", "Competitors"]) {
    await page.getByTestId("sidebar").getByRole("link", { name: section, exact: true }).click();
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("ai-banner")).toHaveCount(0);
    await expect(page.getByText("Ask AI about your posts, analytics or competitors")).toHaveCount(0);
  }
});

test("phone: AI in the centre of the tab bar, no banner, history drawer; Arabic", async ({ browser }) => {
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await login(phone);
  const bar = phone.getByTestId("tab-bar");
  const labels = await bar.getByRole("link").evaluateAll((links) => links.map((l) => l.getAttribute("aria-label")));
  expect(labels).toEqual(["Gallery", "Engagement", "AI", "Insights", "Competitors"]);
  await expect(phone.getByTestId("ai-banner")).toHaveCount(0);

  await bar.getByRole("link", { name: "AI", exact: true }).click();
  await phone.waitForURL(/\/ai$/);
  await phone.getByRole("button", { name: "Chats" }).click();
  await expect(phone.getByRole("dialog", { name: "Chats" })).toBeVisible();
  await phone.getByRole("dialog", { name: "Chats" }).getByRole("button", { name: "Close" }).click();

  // Arabic, right to left.
  await phone.getByTestId("profile-menu-trigger").filter({ visible: true }).click();
  await phone.getByTestId("menu-language").click();
  await expect(phone.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(phone.getByRole("heading", { name: "ماذا ننشر اليوم؟" })).toBeVisible();
  await phone.getByTestId("profile-menu-trigger").filter({ visible: true }).click();
  await phone.getByTestId("menu-language").click();
  await expect(phone.locator("html")).toHaveAttribute("dir", "ltr");
  await phone.close();
});

test("feature switches: Gallery and AI chat disappear everywhere when off", async ({ browser }) => {
  const admin = await browser.newPage();
  await login(admin, ADMIN);
  const [business] = (await (await admin.request.get("/api/admin/businesses?q=mathanet_baity")).json()).data as Array<{ id: string }>;
  const set = (changes: Record<string, boolean>) => admin.request.patch(`/api/admin/businesses/${business.id}/permissions`, { data: { changes } });
  try {
    expect((await set({ aiChat: false })).ok()).toBe(true);
    await page.goto("/gallery");
    await expect(page.getByTestId("sidebar").getByRole("link", { name: "AI", exact: true })).toHaveCount(0);
    await expect(page.getByTestId("ai-banner")).toHaveCount(0);
    await page.locator("main button[aria-label]:has(img)").first().click();
    await expect(page.getByRole("dialog").getByRole("button", { name: "Add to album" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create post with AI" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    expect((await page.request.get("/ai")).status()).toBe(404);
    expect((await page.request.post("/api/ai-chat", { data: { mode: "post", question: "hi" } })).status()).toBe(404);

    // Gallery off: logging in (and old Home links) land on the first section left.
    expect((await set({ gallery: false })).ok()).toBe(true);
    await page.goto("/gallery");
    await expect(page).toHaveURL(/\/engagement\/comments$/);
    await expect(page.getByTestId("sidebar").getByRole("link", { name: "Gallery" })).toHaveCount(0);
  } finally {
    await set({ gallery: true, aiChat: true });
    await admin.close();
  }
  await page.goto("/gallery");
  await expect(page.getByTestId("sidebar").getByRole("link", { name: "Gallery" })).toBeVisible();
  await expect(page.getByTestId("sidebar").getByRole("link", { name: "AI", exact: true })).toBeVisible();
});
