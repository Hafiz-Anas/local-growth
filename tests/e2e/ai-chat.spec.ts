import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * The AI chat (components/ai-chat), in mock mode: the centre AI tab, the start screen (three mode cards
 * and each mode's suggested questions), the proposal's mock answers (chart, photo link, estimate),
 * gallery photos attached inside the chat, the post card's actions, no footer banner (the AI tab is the way in),
 * typed questions (POST /api/ai-chat; stubbed here so the result doesn't depend on the AI provider),
 * the chat list (New chat, Today / Yesterday / Earlier, mode tags, Rename, Delete), chats kept in this
 * browser across a reload, and the feature switches.
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
const chatList = () => page.getByRole("navigation", { name: "Chats" });
const chatItem = (title: string | RegExp) => page.getByTestId("chat-item").filter({ hasText: title });
const questions = () => page.getByTestId("suggested-questions").getByRole("button");

const PROMPTS = {
  Post: ["Create a post from my latest photo", "What should I post tomorrow?", "Combine photos into a new one", "Give me 3 directions for my next post"],
  Analytics: ["How did my posts do this week?", "Which post got shared the most?", "Which post did best this month?", "When should I post?"],
  Competitors: ["What's working for my competitors?", "Give me an idea from their top post", "How do I compare with my competitors?", "Who is growing fastest?"],
};

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await browser.newPage({ viewport: { width: 1366, height: 860 } });
  await login(page);
});
test.afterAll(async () => page.close());

test("the centre AI tab opens the start screen: three mode cards and each mode's suggested questions", async () => {
  await page.getByTestId("sidebar").getByRole("link", { name: "AI", exact: true }).click();
  await page.waitForURL(/\/ai$/);
  await expect(page.getByTestId("sidebar").getByRole("link", { name: "AI", exact: true })).toHaveAttribute("aria-current", "page");
  // Past chats in a column on desktop, seeded from the sample data the first time, each with its mode.
  await expect(chatList()).toBeVisible();
  await expect(chatItem("How did my reach change this week?").getByTestId("chat-mode-tag")).toHaveText("Analytics");
  await expect(chatItem("Who is growing fastest?").getByTestId("chat-mode-tag")).toHaveText("Competitors");

  await expect(page.getByRole("heading", { name: "What would you like to do?" })).toBeVisible();
  for (const [name, body] of [
    ["Post", "Create posts from your photos"],
    ["Analytics", "Understand your results"],
    ["Competitors", "Learn from competitors"],
  ]) {
    await expect(mode(name)).toBeVisible();
    await expect(mode(name)).toHaveAccessibleDescription(body);
  }
  // Post is the default.
  await expect(mode("Post")).toHaveAttribute("aria-pressed", "true");
  await expect(questions()).toHaveText(PROMPTS.Post);
  // A card starts a new chat in its mode and shows its questions.
  await mode("Analytics").click();
  await expect(mode("Analytics")).toHaveAttribute("aria-pressed", "true");
  await expect(mode("Post")).toHaveAttribute("aria-pressed", "false");
  await expect(questions()).toHaveText(PROMPTS.Analytics);
  await mode("Competitors").click();
  await expect(questions()).toHaveText(PROMPTS.Competitors);
  // Nothing else: no mode chips row, no footer banner.
  await expect(page.getByTestId("ai-banner")).toHaveCount(0);
  await mode("Post").click();
});

test("a suggested question sends straight away in its mode and the chat joins Today with its tag", async () => {
  const cases: [keyof typeof PROMPTS, string, RegExp][] = [
    ["Competitors", "What's working for my competitors?", /has the highest engagement/],
    ["Competitors", "Give me an idea from their top post", /post works because it uses/],
    ["Analytics", "Which post got shared the most?", /^Your most shared post is/],
    ["Post", "Create a post from my latest photo", /This looks like/],
  ];
  for (const [name, prompt, reply] of cases) {
    await page.getByRole("button", { name: "New chat" }).first().click();
    await mode(name).click();
    await questions().filter({ hasText: prompt }).click();
    await expect(page.getByText(reply).first()).toBeVisible({ timeout: 20_000 });
    // The open chat's title and mode, and the same at the top of Today.
    await expect(page.getByRole("heading", { name: prompt, level: 2 })).toBeVisible();
    const today = chatList().getByRole("region", { name: "Today" });
    await expect(today.getByTestId("chat-item").first()).toContainText(prompt);
    await expect(today.getByTestId("chat-item").first().getByTestId("chat-mode-tag")).toHaveText(name);
    await expect(today.getByTestId("chat-item").first().getByRole("button").first()).toHaveAttribute("aria-current", "true");
  }
  // The post from the latest photo is the normal post card.
  await expect(page.locator("article").last().getByRole("button", { name: "Approve and schedule" })).toBeVisible();
});

test("mock answers from the sample data: a chart, a photo link and an AI estimate", async () => {
  await page.getByRole("button", { name: "New chat" }).first().click();
  await mode("Competitors").click();
  await page.getByRole("button", { name: "Who is growing fastest?" }).last().click();
  await expect(page.getByText(/is growing fastest: \+/)).toBeVisible();
  await expect(page.getByText("AI estimate")).toBeVisible();

  await page.getByRole("button", { name: "New chat" }).first().click();
  await mode("Analytics").click();
  await page.getByRole("button", { name: "How did my posts do this week?" }).last().click();
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

test("rename and delete (after a confirmation) from a chat's menu; chats survive a reload", async () => {
  await page.getByRole("button", { name: "New chat" }).first().click();
  await mode("Analytics").click();
  await questions().filter({ hasText: "When should I post?" }).click();
  await expect(page.getByText("Your best times to post (Kuwait time):")).toBeVisible();

  // Rename.
  await chatItem("When should I post?").getByRole("button", { name: /^Chat options/ }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const rename = page.getByRole("dialog").last();
  await expect(rename.getByRole("textbox", { name: "Chat name" })).toHaveValue("When should I post?");
  await rename.getByRole("textbox", { name: "Chat name" }).fill("Best times plan");
  await rename.getByRole("button", { name: "Save" }).click();
  await expect(toast("Chat renamed")).toBeVisible();
  await expect(chatItem("Best times plan")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Best times plan", level: 2 })).toBeVisible();

  // Kept in this browser: the list, names, modes and messages come back after a reload.
  await page.reload();
  await expect(chatItem("Best times plan").getByTestId("chat-mode-tag")).toHaveText("Analytics");
  await expect(chatItem("What's working for my competitors?").getByTestId("chat-mode-tag")).toHaveText("Competitors");
  await expect(chatItem("Create a post from my latest photo").getByTestId("chat-mode-tag")).toHaveText("Post");
  await expect(page.getByRole("heading", { name: "What would you like to do?" })).toBeVisible();
  await chatItem("Best times plan").getByRole("button").first().click();
  await expect(page.getByText("Your best times to post (Kuwait time):")).toBeVisible();

  // Delete asks first: Cancel keeps it.
  await chatItem("Best times plan").getByRole("button", { name: /^Chat options/ }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  const confirm = page.getByRole("dialog").last();
  await expect(confirm.getByText("Delete this chat?")).toBeVisible();
  await expect(confirm.getByText("“Best times plan” will be removed from this device.", { exact: false })).toBeVisible();
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(chatItem("Best times plan")).toHaveCount(1);
  // Delete: gone, back on the start screen (it was open), still gone after a reload.
  await chatItem("Best times plan").getByRole("button", { name: /^Chat options/ }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("dialog").last().getByRole("button", { name: "Delete" }).click();
  await expect(toast("Chat deleted")).toBeVisible();
  await expect(chatItem("Best times plan")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "What would you like to do?" })).toBeVisible();
  await page.reload();
  await expect(chatItem("What's working for my competitors?")).toBeVisible();
  await expect(chatItem("Best times plan")).toHaveCount(0);
});

test("no footer banner on any page: the AI tab is the only way into the chat", async () => {
  for (const section of ["Gallery", "Engagement", "Insights", "Competitors"]) {
    await page.getByTestId("sidebar").getByRole("link", { name: section, exact: true }).click();
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("ai-banner")).toHaveCount(0);
    await expect(page.getByText("Ask AI about your posts, analytics or competitors")).toHaveCount(0);
  }
});

test("phone: AI in the centre of the tab bar, no banner, the chat list in a drawer; Arabic", async ({ browser }) => {
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await login(phone);
  const bar = phone.getByTestId("tab-bar");
  const labels = await bar.getByRole("link").evaluateAll((links) => links.map((l) => l.getAttribute("aria-label")));
  expect(labels).toEqual(["Gallery", "Engagement", "AI", "Insights", "Competitors"]);
  await expect(phone.getByTestId("ai-banner")).toHaveCount(0);

  await bar.getByRole("link", { name: "AI", exact: true }).click();
  await phone.waitForURL(/\/ai$/);
  await expect(phone.getByRole("heading", { name: "What would you like to do?" })).toBeVisible();
  await expect(phone.getByRole("navigation", { name: "Chats" })).toHaveCount(0);
  // A question opens the chat; the header shows its title and mode, and the list is a drawer.
  await phone.getByTestId("mode-card-analytics").click();
  await phone.getByTestId("suggested-questions").getByRole("button", { name: "Which post did best this month?" }).click();
  await expect(phone.getByText(/^Your best post this month is/)).toBeVisible();
  await expect(phone.locator("header h1")).toContainText("Which post did best this month?");
  await expect(phone.locator("header h1").getByTestId("chat-mode-tag")).toHaveText("Analytics");
  await phone.getByRole("button", { name: "Chats" }).click();
  const drawer = phone.getByRole("dialog", { name: "Chats" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("button", { name: "New chat" })).toBeVisible();
  await expect(drawer.getByTestId("chat-item").first()).toContainText("Which post did best this month?");
  // Rename from the drawer.
  await drawer.getByTestId("chat-item").first().getByRole("button", { name: /^Chat options/ }).click();
  await phone.getByRole("menuitem", { name: "Rename" }).click();
  await phone.getByRole("textbox", { name: "Chat name" }).fill("Top post");
  await phone.getByRole("button", { name: "Save" }).click();
  await expect(drawer.getByTestId("chat-item").first()).toContainText("Top post");
  // New chat from the drawer goes back to the start screen.
  await drawer.getByRole("button", { name: "New chat" }).click();
  await expect(drawer).toHaveCount(0);
  await expect(phone.getByRole("heading", { name: "What would you like to do?" })).toBeVisible();

  // Arabic, right to left.
  await phone.getByTestId("profile-menu-trigger").filter({ visible: true }).click();
  await phone.getByTestId("menu-language").click();
  await expect(phone.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(phone.getByRole("heading", { name: "ماذا تريد أن تفعل؟" })).toBeVisible();
  for (const name of ["منشور", "الإحصاءات", "المنافسون"]) await expect(phone.getByRole("button", { name, exact: true })).toBeVisible();
  await phone.getByTestId("profile-menu-trigger").filter({ visible: true }).click();
  await phone.getByTestId("menu-language").click();
  await expect(phone.locator("html")).toHaveAttribute("dir", "ltr");
  await phone.close();
});

test("admin preview is read-only: the chats show, without Rename or Delete", async ({ browser }) => {
  const admin = await browser.newPage({ viewport: { width: 1366, height: 860 } });
  await login(admin, ADMIN);
  const [business] = (await (await admin.request.get("/api/admin/businesses?q=mathanet_baity")).json()).data as Array<{ id: string }>;
  await admin.goto(`/admin/clients/${business.id}`);
  await admin.getByRole("button", { name: "Preview as this client" }).click();
  await admin.waitForURL(/\/gallery$/);
  await admin.goto("/ai");
  const list = admin.getByRole("navigation", { name: "Chats" });
  await expect(list.getByTestId("chat-item").first()).toBeVisible();
  await expect(list.getByRole("button", { name: /^Chat options/ })).toHaveCount(0);
  await expect(admin.getByRole("menuitem", { name: "Rename" })).toHaveCount(0);
  // Nothing can be sent: the message box, attach, mode cards and suggested questions are disabled, with a hint.
  await expect(admin.getByRole("note")).toHaveText("Preview is read-only");
  await expect(admin.getByRole("textbox", { name: "Ask anything…" })).toBeDisabled();
  await expect(admin.getByRole("button", { name: "Attach photos" })).toBeDisabled();
  await expect(admin.getByRole("button", { name: "Send" })).toBeDisabled();
  for (const name of ["post", "analytics", "competitors"]) await expect(admin.getByTestId(`mode-card-${name}`)).toBeDisabled();
  for (const q of await admin.getByTestId("suggested-questions").getByRole("button").all()) await expect(q).toBeDisabled();
  const before = await list.getByTestId("chat-item").count();
  // Chats still open for reading.
  await list.getByTestId("chat-item").first().getByRole("button").first().click();
  await expect(list.getByTestId("chat-item").first().getByRole("button").first()).toHaveAttribute("aria-current", "true");
  await expect(admin.getByRole("textbox", { name: "Ask anything…" })).toBeDisabled();
  for (const chip of await admin.getByRole("group", { name: "Try asking" }).getByRole("button").all()) await expect(chip).toBeDisabled();
  await expect(list.getByTestId("chat-item")).toHaveCount(before);
  await admin.getByRole("button", { name: "Exit preview" }).click();
  await admin.waitForURL(/\/admin/);
  await admin.close();
  // The client still has the menu.
  await page.goto("/ai");
  await expect(chatList().getByRole("button", { name: /^Chat options/ }).first()).toBeVisible();
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
