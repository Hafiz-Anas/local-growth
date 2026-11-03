import path from "node:path";
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { competitorSummary, type FollowerGrowth, type SummaryPost } from "../../lib/analysis/competitor-summary";
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
  return shown(p).getByTestId("competitor-post-image");
}

/**
 * The viewer fits the screen: both actions are in view without scrolling, the post itself doesn't scroll
 * and the page behind is locked (scrolling the wheel over it moves nothing).
 */
async function expectFitted(p: Page) {
  await expect(viewer(p).getByRole("button", { name: "Create a similar post" })).toBeInViewport({ ratio: 1 });
  await expect(viewer(p).getByRole("button", { name: /^(Save as inspiration|Saved)$/ })).toBeInViewport({ ratio: 1 });
  const post = await shown(p).evaluate((el) => ({ scroll: el.scrollHeight - el.clientHeight, overflow: getComputedStyle(el).overflowY }));
  expect(post.scroll).toBeLessThanOrEqual(0);
  expect(post.overflow).not.toMatch(/auto|scroll/);
  expect(await p.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe("hidden");
  const before = await p.evaluate(() => window.scrollY);
  await p.mouse.move(10, 300);
  await p.mouse.wheel(0, 600);
  await p.waitForTimeout(300);
  expect(await p.evaluate(() => window.scrollY)).toBe(before);
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
  // Desktop: Instagram's desktop post — picture on the left, a side panel with the actions at its bottom.
  const image = (await shown().getByTestId("competitor-post-image").boundingBox())!;
  const actions = (await viewer().getByTestId("competitor-actions").filter({ visible: true }).boundingBox())!;
  expect(actions.x).toBeGreaterThanOrEqual(image.x + image.width - 1);
  expect(Math.round(image.width)).toBe(Math.round(image.height));
  await expectFitted(page);

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
  // The page scrolls again once the viewer is closed.
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).not.toBe("hidden");
});

test("on a phone: caption on 2 lines with … more, actions pinned at the bottom, swipe between posts, swipe down to close", async ({ browser }) => {
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  try {
    await login(phone);
    // The demo captions all fit on 2 lines: give the first post a long one (as real competitors often have).
    const long = Array.from({ length: 12 }, (_, i) => `Line ${i + 1}: fresh beans roasted this morning, come by and taste them.`).join("\n") + " #specialtycoffee";
    await phone.route(`**/api/competitors/${rival.id}`, async (route) => {
      const json = await (await route.fetch()).json();
      json.data.recentPosts[0].caption = long;
      await route.fulfill({ json });
    });
    await openProfile(phone);
    // Cut to 2 lines with "… more", which expands it in its own scroll area.
    await phone.getByTestId("competitor-post-tile").nth(1).click();
    await expectFitted(phone);
    const caption = shown(phone).getByTestId("competitor-caption");
    const collapsed = (await caption.boundingBox())!.height;
    await caption.getByRole("button", { name: "… more" }).click();
    await expect(caption.getByRole("button", { name: "less" })).toHaveAttribute("aria-expanded", "true");
    expect((await caption.boundingBox())!.height).toBeGreaterThan(collapsed);
    await expectFitted(phone);
    // Picture on top, the account and caption below it, the actions below those.
    const image = (await shown(phone).getByTestId("competitor-post-image").boundingBox())!;
    const bar = (await viewer(phone).getByTestId("competitor-actions").filter({ visible: true }).boundingBox())!;
    expect((await caption.boundingBox())!.y).toBeGreaterThan(image.y + image.height - 1);
    expect(bar.y).toBeGreaterThanOrEqual((await caption.boundingBox())!.y + (await caption.boundingBox())!.height - 1);
    await caption.getByRole("button", { name: "less" }).click();

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

    // Approve saves the post as a draft and opens the Schedule sheet (closing it schedules nothing).
    await card.getByRole("button", { name: "Approve and schedule" }).click();
    await expect(page.getByRole("dialog", { name: "Schedule" }).getByRole("button", { name: "Schedule post" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Schedule" })).toHaveCount(0);
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

// ── Accounts: expandable cards (UX4) ─────────────────────────────────────────────

const SHOTS = process.env.E2E_SHOTS_DIR ?? "test-results/competitor-shots";
type ListItem = { id: string; handle: string; recentPosts: SummaryPost[]; growth: FollowerGrowth | null };
const cardOf = (p: Page, handle: string) => p.locator("main article").filter({ hasText: `@${handle}` });
const fmt = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(n);

test("Accounts: Show details expands a card in place with growth, posts per week, formats and observations, each with its period", async () => {
  const list = (await (await page.request.get("/api/competitors")).json()).data as ListItem[];
  const first = list[0];
  // The numbers come from the same pure code as the card, from what the API returns.
  const expected = competitorSummary(first.recentPosts);
  expect(expected.enough).toBe(true);

  await page.goto("/competitors");
  const card = cardOf(page, first.handle);
  const toggle = card.getByTestId("details-toggle");
  await expect(toggle).toHaveText("Show details");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(card.getByTestId("competitor-details")).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveText("Hide details");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const details = card.getByTestId("competitor-details");
  await expect(details).toBeVisible();
  // Expands in place: the page didn't navigate, the other cards stay closed.
  await expect(page).toHaveURL(/\/competitors$/);
  await expect(page.getByTestId("competitor-details")).toHaveCount(1);

  const growth = details.getByTestId("details-growth");
  if (first.growth) {
    await expect(growth).toContainText(`Last ${first.growth.days} days`);
    await expect(growth).toContainText(`followers in ${first.growth.days} days`);
  } else {
    await expect(growth).toContainText("Not enough follower history yet");
  }
  const frequency = details.getByTestId("details-frequency");
  await expect(frequency).toContainText(fmt(expected.postsPerWeek!));
  await expect(frequency).toContainText(`${expected.posts} posts in the last ${expected.days} days`);
  const formats = details.getByTestId("details-formats");
  for (const f of expected.formats) await expect(formats).toContainText(`${fmt(f.sharePct)}%`);
  const observations = details.getByTestId("details-observations");
  await expect(observations.getByRole("listitem")).toHaveCount(Math.max(1, expected.observations.length));
  await expect(observations).toContainText(`Last ${expected.days} days`);
  await expect(details.getByTestId("details-top-post")).toHaveCount(Math.min(3, expected.top.length));
  await expect(details.getByRole("link", { name: "View full analysis" })).toHaveAttribute("href", `/competitors/${first.id}`);
  await page.screenshot({ path: path.join(SHOTS, "desktop-expanded.png"), fullPage: true });

  await toggle.click();
  await expect(card.getByTestId("competitor-details")).toHaveCount(0);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
});

type Box = { x: number; y: number; width: number; height: number };
const box = async (l: Locator): Promise<Box> => (await l.boundingBox())!;

test("Accounts layout: two wide cards per row on desktop; expanding one leaves its neighbour alone; the details sit in a tidy grid", async () => {
  await page.goto("/competitors");
  const grid = page.getByTestId("competitor-grid");
  const cards = grid.locator(":scope > article");
  await expect(cards.first()).toBeVisible();
  expect(await cards.count()).toBeGreaterThanOrEqual(2);
  const [a, b] = [await box(cards.nth(0)), await box(cards.nth(1))];
  const gridBox = await box(grid);
  // Two per row, side by side, each about half the column (not a third).
  expect(Math.abs(a.y - b.y)).toBeLessThan(2);
  expect(a.width).toBeGreaterThan(gridBox.width * 0.45);
  expect(Math.abs(a.width - b.width)).toBeLessThan(2);
  if ((await cards.count()) >= 3) expect((await box(cards.nth(2))).y).toBeGreaterThan(a.y + a.height - 1);
  // A wide card puts the top post beside the numbers.
  const body = cards.nth(0).getByTestId("card-body");
  const [image, numbers] = [await box(body.locator(":scope > div").first()), await box(body.locator("dl"))];
  expect(Math.abs(image.y + image.height / 2 - (numbers.y + numbers.height / 2))).toBeLessThan(image.height / 2);
  expect(numbers.x).toBeGreaterThan(image.x + image.width - 1);

  await cards.nth(0).getByTestId("details-toggle").click();
  const details = cards.nth(0).getByTestId("competitor-details");
  await expect(details).toBeVisible();
  // The neighbour keeps its height and place.
  const after = await box(cards.nth(1));
  expect(Math.abs(after.height - b.height)).toBeLessThan(2);
  expect(Math.abs(after.y - b.y)).toBeLessThan(2);
  expect((await box(cards.nth(0))).height).toBeGreaterThan(a.height + 100);
  // Growth and posts per week side by side, the formats bar full width, top posts as one row of tiles.
  const growth = await box(details.getByTestId("details-growth"));
  const frequency = await box(details.getByTestId("details-frequency"));
  const formats = await box(details.getByTestId("details-formats"));
  expect(Math.abs(growth.y - frequency.y)).toBeLessThan(2);
  expect(Math.abs(frequency.x - growth.x)).toBeGreaterThan(50);
  expect(formats.width).toBeGreaterThan(growth.width + frequency.width);
  const tiles = details.getByTestId("details-top-post");
  const tops = await Promise.all((await tiles.all()).map(async (t) => (await box(t)).y));
  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(2);
  await page.screenshot({ path: path.join(SHOTS, "desktop-layout-expanded.png"), fullPage: true });
  await cards.nth(0).getByTestId("details-toggle").click();
});

test("Accounts layout on a phone: one card per row, the expanded details stacked", async ({ browser }) => {
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  try {
    await login(phone);
    await phone.goto("/competitors");
    const cards = phone.getByTestId("competitor-grid").locator(":scope > article");
    await expect(cards.first()).toBeVisible();
    const [a, b] = [await box(cards.nth(0)), await box(cards.nth(1))];
    expect(Math.abs(a.x - b.x)).toBeLessThan(2);
    expect(b.y).toBeGreaterThan(a.y + a.height - 1);
    await cards.nth(0).getByTestId("details-toggle").click();
    const details = cards.nth(0).getByTestId("competitor-details");
    const growth = await box(details.getByTestId("details-growth"));
    const frequency = await box(details.getByTestId("details-frequency"));
    expect(frequency.y).toBeGreaterThan(growth.y + growth.height - 1);
    expect(await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await details.scrollIntoViewIfNeeded();
    await phone.screenshot({ path: path.join(SHOTS, "phone-expanded.png"), fullPage: true });
  } finally {
    await phone.close();
  }
});

test("Accounts: top posts open in the viewer; Save as inspiration and Create a similar post work from the card", async () => {
  const list = (await (await page.request.get("/api/competitors")).json()).data as ListItem[];
  const first = list[0];
  await page.goto("/competitors");
  const card = cardOf(page, first.handle);
  await card.getByTestId("details-toggle").click();
  const details = card.getByTestId("competitor-details");

  // The top post opens in the Gallery's viewer with the competitor actions.
  await details.getByTestId("details-top-post").first().click();
  await expect(viewer().getByTestId("competitor-post")).toBeVisible();
  await expect(viewer().getByRole("button", { name: "Create a similar post" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(viewer()).toHaveCount(0);

  // Save as inspiration toggles for their top post, and the post is in this browser's Inspiration list.
  const save = details.getByTestId("details-save");
  if ((await save.getAttribute("aria-pressed")) === "true") await save.click();
  await expect(save).toHaveAttribute("aria-pressed", "false");
  await save.click();
  await expect(save).toHaveAttribute("aria-pressed", "true");
  await expect(save).toHaveText("Saved as inspiration");
  const saved = await page.evaluate(() => Object.entries(localStorage).find(([k]) => k.startsWith("lge_inspiration:"))?.[1] ?? "[]");
  expect((JSON.parse(saved) as Array<{ competitorId: string }>).some((s) => s.competitorId === first.id)).toBe(true);
  await save.click();
  await expect(save).toHaveAttribute("aria-pressed", "false");

  // Create a similar post: the AI tab with their post as the reference.
  await details.getByTestId("details-similar").click();
  await page.waitForURL(/\/ai$/);
  await expect(page.getByRole("textbox", { name: "Ask anything…" })).toHaveValue(`Create a post like @${first.handle}'s for my business`);
});

test("Accounts: not enough data — the card says so instead of showing numbers", async () => {
  // A competitor with one recent post and no follower history (the API's answer, trimmed).
  await page.route("**/api/competitors", async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { ok: true; data: ListItem[] };
    // Their newest post only (the mock dates some posts later today; those don't count yet).
    const past = body.data[0].recentPosts.filter((p) => p.postedAt && Date.parse(p.postedAt) <= Date.now());
    const newest = past.sort((a, b) => b.postedAt!.localeCompare(a.postedAt!))[0];
    body.data[0] = { ...body.data[0], recentPosts: [newest], growth: null };
    await route.fulfill({ response: res, json: body });
  });
  try {
    const list = (await (await page.request.get("/api/competitors")).json()).data as ListItem[];
    await page.goto("/competitors");
    const card = cardOf(page, list[0].handle);
    await card.getByTestId("details-toggle").click();
    const details = card.getByTestId("competitor-details");
    await expect(details.getByTestId("details-not-enough")).toContainText("Not enough recent posts to compare yet (1 in the last");
    await expect(details.getByTestId("details-growth")).toContainText("Not enough follower history yet");
    await expect(details.getByTestId("details-frequency")).toHaveCount(0);
    await expect(details.getByTestId("details-observations")).toHaveCount(0);
    await expect(details.getByTestId("details-top-post")).toHaveCount(1);
    await page.screenshot({ path: path.join(SHOTS, "desktop-not-enough.png") });
  } finally {
    await page.unroute("**/api/competitors");
  }
});

test("Accounts on a phone, in Arabic: the expanded card fits, right to left", async ({ browser }) => {
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await login(phone);
  const language = async (dir: "rtl" | "ltr") => {
    if ((await phone.locator("html").getAttribute("dir")) !== dir) {
      await phone.getByTestId("profile-menu-trigger").filter({ visible: true }).click();
      await phone.getByTestId("menu-language").click();
    }
    await expect(phone.locator("html")).toHaveAttribute("dir", dir);
  };
  try {
    await phone.goto("/competitors");
    await language("rtl");
    const toggle = phone.getByTestId("details-toggle").first();
    await expect(toggle).toHaveText("عرض التفاصيل");
    await toggle.click();
    await expect(toggle).toHaveText("إخفاء التفاصيل");
    const details = phone.getByTestId("competitor-details").first();
    await expect(details.getByTestId("details-frequency")).toContainText("منشورات في الأسبوع");
    await expect(details.getByRole("link", { name: "عرض التحليل الكامل" })).toBeVisible();
    expect(await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await details.scrollIntoViewIfNeeded();
    await phone.screenshot({ path: path.join(SHOTS, "phone-arabic-expanded.png"), fullPage: true });
  } finally {
    await language("ltr");
    await phone.close();
  }
});
