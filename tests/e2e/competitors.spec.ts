import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { startGeminiStub } from "./gemini-stub";

/**
 * Competitors: tabs like Insights (Accounts · Analysis · Inspiration, each with a line under its title),
 * a competitor's posts in the Gallery's viewer (open, arrows/swipe between their posts, Esc / swipe down
 * to close), "Create a similar post" in the AI chat (the sample answer when the AI gives none, the AI's
 * when it does, never a copied caption) and "Save as inspiration" → the Inspiration tab. The viewer, the
 * chat are front-end state (lib/gallery/store.ts, reset on a page load), so the specs move with in-app
 * links in the chat flows; saved inspiration is also kept in localStorage per business and survives a
 * reload. Uses the seeded "Mathanet Baity" (pro plan) and its mock competitors.
 */

const USER = { email: "user@mathanetbaity.dev", password: "User@123" };
const ADMIN = { email: "admin@localgrowth.dev", password: "Admin@123" };

test.describe.configure({ mode: "serial", timeout: 120_000 });

type Post = { id: string; caption?: string; likes: number };
type Competitor = { id: string; handle: string; displayName: string | null; name: string; recentPosts: Post[] };

let stub: Awaited<ReturnType<typeof startGeminiStub>>;
let page: Page;
let rival: Competitor;

async function login(p: Page, account = USER) {
  await p.goto("/login");
  await p.getByLabel("Email").fill(account.email);
  await p.getByLabel("Password", { exact: true }).fill(account.password);
  await p.getByRole("button", { name: "Log in" }).click();
  await p.waitForURL((url) => !url.pathname.startsWith("/login"));
}

async function asAdmin(browser: Browser, work: (admin: Page, businessId: string) => Promise<unknown>) {
  const admin = await browser.newPage();
  try {
    await login(admin, ADMIN);
    const [business] = (await (await admin.request.get("/api/admin/businesses?q=mathanet_baity")).json()).data as Array<{ id: string }>;
    await work(admin, business.id);
  } finally {
    await admin.close();
  }
}

const viewer = (p = page) => p.getByRole("dialog");
const toast = (text: string | RegExp) => page.locator("[data-sonner-toast]").filter({ hasText: text });
const tabs = () => page.getByTestId("section-tabs");
/** The post on screen (the outgoing one lingers for a moment while the next slides in). */
const shown = (p = page) => viewer(p).getByTestId("competitor-post").last();
/** Waits for the slide animation to finish (only one post left on screen), then returns its picture. */
async function picture(p = page) {
  await expect(viewer(p).getByTestId("competitor-post")).toHaveCount(1);
  return shown(p).locator(".aspect-square");
}

async function openProfile(p = page) {
  await p.goto(`/competitors/${rival.id}`);
  await expect(p.getByRole("heading", { level: 1 })).toContainText(rival.displayName || rival.name);
}

/** Drags across the post's picture with the mouse (framer-motion reads pointer events like a finger). */
async function swipe(p: Page, target: Locator, dx: number, dy: number) {
  const box = (await target.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await p.mouse.move(x, y);
  await p.mouse.down();
  await p.mouse.move(x + dx / 2, y + dy / 2, { steps: 6 });
  await p.mouse.move(x + dx, y + dy, { steps: 6 });
  await p.mouse.up();
}

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  stub = await startGeminiStub();
  page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  await login(page);
  const list = (await (await page.request.get("/api/competitors")).json()).data as Array<{ id: string }>;
  rival = (await (await page.request.get(`/api/competitors/${list[0].id}`)).json()).data as Competitor;
  expect(rival.recentPosts.length).toBeGreaterThan(3);
});
test.afterAll(async () => {
  await page.close();
  await stub.close();
});

test("tabs like Insights: Accounts, Analysis and Inspiration, each with a short line; the old URLs keep working", async () => {
  await page.goto("/competitors");
  await expect(page.getByTestId("section-tab-label")).toHaveText(["Accounts", "Analysis", "Inspiration"]);
  for (const line of ["Who you're watching", "How you compare", "Posts you saved"]) await expect(tabs().getByText(line)).toBeVisible();
  await expect(tabs().getByRole("link", { name: "Accounts" })).toHaveAttribute("aria-current", "page");

  await page.goto("/competitors/analysis");
  await expect(tabs().getByRole("link", { name: "Analysis" })).toHaveAttribute("aria-current", "page");
  // A competitor's profile belongs to the Accounts tab.
  await openProfile();
  await expect(tabs().getByRole("link", { name: "Accounts" })).toHaveAttribute("aria-current", "page");

  await tabs().getByRole("link", { name: "Inspiration" }).click();
  await page.waitForURL(/\/competitors\/inspiration$/);
  await expect(tabs().getByRole("link", { name: "Inspiration" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Save posts from competitors to get ideas later.")).toBeVisible();
});

test("a competitor's post opens in the Gallery viewer: Instagram-style, arrows and swipes between their posts, Esc closes", async () => {
  await openProfile();
  const total = rival.recentPosts.length;
  await page.getByTestId("competitor-post-tile").nth(2).click(); // the top post comes first, then the grid
  await expect(viewer()).toBeVisible();
  await expect(viewer().getByRole("heading", { name: "Competitor post" })).toBeVisible();
  await expect(viewer().getByText(`2/${total}`)).toBeVisible();
  const second = rival.recentPosts[1];
  await expect(shown()).toContainText(rival.handle);
  if (second.caption) await expect(shown()).toContainText(second.caption.split(/\s+/).slice(0, 3).join(" "));
  await expect(shown().getByTitle("Likes")).toBeVisible();
  await expect(shown().getByTitle("Comments")).toBeVisible();
  await expect(shown().locator("time")).toBeVisible();
  // Only the competitor actions: never albums, Favourites or Delete.
  for (const name of ["Add to album", "Favorite", "Delete"]) await expect(viewer().getByRole("button", { name })).toHaveCount(0);
  await expect(viewer().getByRole("button", { name: "Create a similar post" })).toBeVisible();
  await expect(viewer().getByRole("button", { name: "Save as inspiration" })).toBeVisible();

  await viewer().getByRole("button", { name: "Next photo" }).click();
  await expect(viewer().getByText(`3/${total}`)).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(viewer().getByText(`2/${total}`)).toBeVisible();
  await swipe(page, await picture(), -260, 0);
  await expect(viewer().getByText(`3/${total}`)).toBeVisible();
  await swipe(page, await picture(), 260, 0);
  await expect(viewer().getByText(`2/${total}`)).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(viewer()).toHaveCount(0);
});

test("on a phone: swipe between posts, swipe down to close", async ({ browser }) => {
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  try {
    await login(phone);
    await openProfile(phone);
    await phone.getByTestId("competitor-post-tile").first().click();
    const total = rival.recentPosts.length;
    await expect(viewer(phone).getByText(new RegExp(`^\\d+/${total}$`))).toBeVisible();
    const before = await viewer(phone).getByText(new RegExp(`^\\d+/${total}$`)).innerText();
    await swipe(phone, await picture(phone), -220, 0);
    await expect(viewer(phone).getByText(new RegExp(`^\\d+/${total}$`))).not.toHaveText(before);
    await swipe(phone, await picture(phone), 0, 260);
    await expect(viewer(phone)).toHaveCount(0);
  } finally {
    await phone.close();
  }
});

test("Save as inspiration: a Saved state that toggles, then the post in the Inspiration tab, labelled by competitor", async () => {
  await openProfile();
  await page.getByTestId("competitor-post-tile").nth(1).click();
  const save = () => viewer().getByRole("button", { name: /^(Save as inspiration|Saved)$/ });
  await expect(save()).toHaveAttribute("aria-pressed", "false");
  await save().click();
  await expect(toast("Saved to Inspiration")).toBeVisible();
  await expect(save()).toHaveText("Saved");
  await expect(save()).toHaveAttribute("aria-pressed", "true");
  await save().click();
  await expect(toast("Removed from Inspiration")).toBeVisible();
  await expect(save()).toHaveText("Save as inspiration");
  await save().click();
  await expect(save()).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");

  // In-app link: the saved posts live in the page's memory, like the Gallery.
  await tabs().getByRole("link", { name: "Inspiration" }).click();
  await page.waitForURL(/\/competitors\/inspiration$/);
  const items = page.getByTestId("inspiration-item");
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText(`@${rival.handle}`);
  await expect(items.first()).toContainText(rival.displayName || rival.name);
  // Kept in this browser: still there after a reload, under this business's own key.
  await page.reload();
  await expect(items).toHaveCount(1);
  const stored = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("lge_inspiration:")));
  expect(stored).toHaveLength(1);
  await items.first().click();
  await expect(viewer().getByRole("button", { name: "Saved" })).toHaveAttribute("aria-pressed", "true");
  await expect(viewer().getByRole("button", { name: "Create a similar post" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(viewer()).toHaveCount(0);
});

test("Create a similar post (mock mode): the chat explains why it works and writes a post card on the owner's own photo", async () => {
  // As with the mock AI (or Gemini off / over budget): the route answers null and the chat writes the sample answer.
  await page.route("**/api/ai-chat/similar-post", (route) => route.fulfill({ json: { ok: true, data: { post: null } } }));
  try {
    // From the Inspiration tab.
    await page.getByTestId("inspiration-item").first().click();
    await viewer().getByRole("button", { name: "Create a similar post" }).click();
    await page.waitForURL(/\/ai$/);
    const composer = page.getByRole("textbox", { name: "Ask anything…" });
    await expect(composer).toHaveValue(`Create a post like @${rival.handle}'s for my business`);
    await expect(page.getByTestId("chat-reference")).toBeVisible();
    await page.getByRole("button", { name: "Send" }).click();

    await expect(page.getByText(`Why @${rival.handle}'s post works:`)).toBeVisible({ timeout: 20_000 });
    for (const part of [/• Topic: /, /• Style: Written as /, /• Hook: It opens with /]) await expect(page.getByText(part)).toBeVisible();
    await expect(page.getByText(/Here's a new post in that style for you, on your own ".+" photo/)).toBeVisible();
    const card = page.locator("article").last();
    await expect(card.getByText(`Inspired by @${rival.handle}`)).toBeVisible();
    await expect(card.getByText("New caption written for you. Nothing is copied.")).toBeVisible();
    await expect(card.getByRole("button", { name: "Approve and schedule" })).toBeVisible();
    for (const action of ["Post now", "Edit", "Regenerate", "Save to gallery"]) await expect(card.getByRole("button", { name: action })).toBeVisible();
    // The owner's own photo, never the competitor's caption.
    await expect(card.locator('img[src*="/photos/"]').first()).toBeVisible();
    const theirs = rival.recentPosts.map((p) => p.caption).filter((c): c is string => Boolean(c));
    const caption = await card.locator("p[lang]").first().innerText();
    for (const c of theirs) expect(caption).not.toContain(c.replace(/#\S+/g, "").trim());

    await card.getByRole("button", { name: "Approve and schedule" }).click();
    await expect(toast(/Scheduled for /)).toBeVisible();
    await expect(card.getByRole("status")).toBeVisible();
  } finally {
    await page.unroute("**/api/ai-chat/similar-post");
  }
});

test("Create a similar post with the AI: its explanation and caption; a copied caption falls back to the sample answer", async () => {
  // From the competitor's profile this time.
  await openProfile();
  await page.getByTestId("competitor-post-tile").nth(1).click();
  await viewer().getByRole("button", { name: "Create a similar post" }).click();
  await page.waitForURL(/\/ai$/);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("• Hook: Something new in the first line.")).toBeVisible({ timeout: 20_000 });
  const card = page.locator("article").last();
  await expect(card.getByText("Stub similar caption for your photo. Order by DM today.")).toBeVisible();
  await expect(card.getByText("#stubtag")).toBeVisible();
  const call = stub.calls.filter((c) => c.kind === "similar").at(-1)!;
  expect(call.system).toContain(`@${rival.handle}`);
  expect(call.system).toMatch(/<photo>\nShows: /);

  stub.state.copySimilar = true;
  try {
    await openProfile();
    await page.getByTestId("competitor-post-tile").nth(1).click();
    await viewer().getByRole("button", { name: "Create a similar post" }).click();
    await page.waitForURL(/\/ai$/);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/• Style: Written as /)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("article").last().getByText("Stub similar caption")).toHaveCount(0);
  } finally {
    stub.state.copySimilar = false;
  }
});

test("feature switch: with Inspiration off there is no tab, no route and no Save button", async ({ browser }) => {
  const set = (enabled: boolean) =>
    asAdmin(browser, async (admin, id) => {
      const res = await admin.request.patch(`/api/admin/businesses/${id}/permissions`, { data: { changes: { "competitors.inspiration": enabled } } });
      expect(res.ok(), await res.text()).toBe(true);
    });
  await set(false);
  try {
    await page.goto("/competitors");
    await expect(page.getByTestId("section-tab-label")).toHaveText(["Accounts", "Analysis"]);
    expect((await page.request.get("/competitors/inspiration")).status()).toBe(404);
    await openProfile();
    await page.getByTestId("competitor-post-tile").first().click();
    await expect(viewer().getByRole("button", { name: "Create a similar post" })).toBeVisible();
    await expect(viewer().getByRole("button", { name: "Save as inspiration" })).toHaveCount(0);
    await page.keyboard.press("Escape");
  } finally {
    await set(true);
  }
});
