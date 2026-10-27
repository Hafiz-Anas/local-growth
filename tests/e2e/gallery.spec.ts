import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";

/**
 * The Gallery (components/gallery, copied from the design proposal): front-end only, on the
 * proposal's mock data (mock-data/gallery) held in memory — so the specs move around with in-app
 * links, never page.goto, once they've changed something. Library grouped by date, badges, albums
 * (category albums + collections), the viewer (plain photo vs. ready post), photo actions, select
 * mode, upload, and "Create post with AI" through Approve / Save to gallery. Uses the seeded
 * "Mathanet Baity" demo business (home-cooking sample photos).
 */

const USER = { email: "user@mathanetbaity.dev", password: "User@123" };

// Long flows (the chat's animated steps, toasts that cover the top of the page for a few seconds).
test.describe.configure({ mode: "serial", timeout: 120_000 });

async function login(p: Page) {
  await p.goto("/login");
  await p.getByLabel("Email").fill(USER.email);
  await p.getByLabel("Password", { exact: true }).fill(USER.password);
  await p.getByRole("button", { name: "Log in" }).click();
  await p.waitForURL((url) => !url.pathname.startsWith("/login"));
}

let page: Page;
const main = () => page.locator("main");
/** Photo tiles in the grid (each is a button named after the photo). */
const tiles = () => main().locator("button[aria-label]:has(img)");
const viewer = () => page.getByRole("dialog");
const sidebar = () => page.getByTestId("sidebar");
const toast = (text: string | RegExp) => page.locator("[data-sonner-toast]").filter({ hasText: text });
/** A ready post has the "Ready post · …" badge; a plain photo doesn't. */
const isPostTile = async (tile: Locator) => (await tile.locator('span[title^="Ready post"]').count()) > 0;

async function firstTile(kind: "plain" | "post"): Promise<Locator> {
  const n = await tiles().count();
  for (let i = 0; i < n; i++) if ((kind === "post") === (await isPostTile(tiles().nth(i)))) return tiles().nth(i);
  throw new Error(`no ${kind} tile`);
}
/** Closes whatever sheets and viewer are still open (Escape closes the top one). */
async function closeAll() {
  for (let i = 0; i < 5 && (await page.getByRole("dialog").count()) > 0; i++) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Toasts sit over the top of the page for a few seconds (as in the proposal).
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 10_000 });
}
async function openAlbums() {
  await closeAll();
  await main().getByRole("tab", { name: "Albums" }).click();
}
/** Album card in the Albums view: its name and photo count. */
const albumCard = (name: string) => main().getByRole("button", { name: new RegExp(`^${name}\\s*\\d+$`) });
const albumCount = async (name: string) => Number((await albumCard(name).innerText()).match(/(\d+)\s*$/)![1]);
async function backToGallery() {
  await sidebar().getByRole("link", { name: "Gallery" }).click();
  await page.waitForURL(/\/gallery$/);
}

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await browser.newPage({ viewport: { width: 1366, height: 860 } });
  await login(page);
});
test.afterAll(async () => page.close());

test("lands on the Gallery after login; old Home and Posts links redirect there; the old assistant is gone", async () => {
  await expect(page).toHaveURL(/\/gallery$/);
  await expect(sidebar().getByRole("link", { name: "Gallery" })).toHaveAttribute("aria-current", "page");
  for (const old of ["/dashboard", "/post-generator"]) {
    await page.goto(old);
    await expect(page).toHaveURL(/\/gallery$/);
  }
  expect((await page.request.get("/assistant")).status()).toBe(404);
  expect((await page.request.get("/api/assistant")).status()).toBe(404);
});

test("Library: a dense photo grid grouped by date, with the source and published badges", async () => {
  await page.goto("/gallery");
  await expect(main().getByRole("tab", { name: "Library" })).toHaveAttribute("aria-selected", "true");
  await expect(main().getByRole("heading", { name: "This week" })).toBeVisible();
  await expect(main().getByRole("heading", { name: "Last week" })).toBeVisible();
  expect(await tiles().count()).toBeGreaterThan(20);
  // Source badge on every tile (AI or uploaded); the published badge on Instagram posts only.
  await expect(main().locator('span[title="Made by AI"]').first()).toBeVisible();
  await expect(main().locator('span[title="Uploaded by you"]').first()).toBeVisible();
  await expect(main().locator('span[title="Ready post · Published"]').first()).toBeVisible();
  await expect(main().locator('span[title="Ready post · Scheduled"]').first()).toBeVisible();
  // Five columns on desktop, edge to edge like Photos.
  const boxes = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => tiles().nth(i).boundingBox()));
  expect(new Set(boxes.slice(0, 5).map((b) => Math.round(b!.y))).size).toBe(1);
});

test("Albums: category albums and every collection, each opening its photos", async () => {
  await openAlbums();
  await expect(main().getByRole("heading", { name: "My Albums" })).toBeVisible();
  for (const name of ["Main dishes", "Appetizers", "Sweets", "Family spreads"]) await expect(albumCard(name)).toBeVisible();
  await expect(main().getByRole("button", { name: "New album" })).toBeVisible();
  await expect(main().getByRole("heading", { name: "Collections" })).toBeVisible();
  for (const name of ["All Photos", "Uploads", "Instagram", "Drafts", "Scheduled", "AI Generated", "Favorites"]) await expect(albumCard(name)).toBeVisible();

  const sweets = await albumCount("Sweets");
  await albumCard("Sweets").click();
  await expect(main().getByRole("heading", { name: "Sweets", level: 1 })).toBeVisible();
  await expect(main().getByText(`${sweets} photos`)).toBeVisible();
  await expect(tiles()).toHaveCount(sweets);
  await main().getByRole("button", { name: "Back" }).click();
  await expect(main().getByRole("heading", { name: "Collections" })).toBeVisible();
  await main().getByRole("tab", { name: "Library" }).click();
});

test("a plain photo opens full screen with Create post with AI, Add to album, Favorite and Delete — no Schedule", async () => {
  const tile = await firstTile("plain");
  const name = (await tile.getAttribute("aria-label"))!;
  await tile.click();
  await expect(viewer()).toHaveAttribute("aria-label", name);
  await expect(viewer().getByRole("heading", { name })).toBeVisible();
  await expect(viewer()).toHaveCSS("background-color", "rgb(0, 0, 0)");
  for (const action of ["Create post with AI", "Add to album", "Favorite", "Delete"]) await expect(viewer().getByRole("button", { name: action, exact: true })).toBeVisible();
  await expect(viewer().getByRole("button", { name: /Schedule/ })).toHaveCount(0);
  await expect(viewer().getByRole("button", { name: "Open post" })).toHaveCount(0);
  await viewer().getByRole("button", { name: "Close" }).click();
  await expect(viewer()).toHaveCount(0);
});

test("a published post opens as an Instagram post with its caption and hashtags; Open post shows the full post", async () => {
  const tile = main().locator('button[aria-label]:has(span[title="Ready post · Published"])').first();
  await tile.click();
  await expect(viewer().getByRole("heading", { name: "Ready post" })).toBeVisible();
  await expect(viewer().getByText(/^Published/).first()).toBeVisible();
  await expect(viewer().locator("bdi", { hasText: /^#/ }).first()).toBeVisible();
  await expect(viewer().getByRole("button", { name: "View performance" })).toBeVisible();
  await viewer().getByRole("button", { name: "Open post" }).click();
  const sheet = page.getByRole("dialog", { name: "Ready post" }).last();
  await expect(sheet.getByRole("button", { name: "View performance" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Edit" })).toBeVisible();
  // Caption language switch (EN / ع).
  await sheet.getByRole("tab", { name: "ع" }).click();
  await expect(sheet.locator('[lang="ar"]').first()).toBeVisible();
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await viewer().getByRole("button", { name: "Close" }).click();
  await expect(viewer()).toHaveCount(0);
});

test("a scheduled post can be rescheduled or posted now from Open post", async () => {
  await main().locator('button[aria-label]:has(span[title="Ready post · Scheduled"])').first().click();
  await viewer().getByRole("button", { name: "Open post" }).click();
  const sheet = page.getByRole("dialog", { name: "Ready post" }).last();
  await sheet.getByRole("button", { name: "Reschedule" }).click();
  const schedule = page.getByRole("dialog", { name: "Schedule" });
  await expect(schedule.getByText("Best time to post")).toBeVisible();
  await expect(schedule.getByRole("radio")).toHaveCount(5);
  await schedule.getByRole("button", { name: "Schedule", exact: true }).click();
  await expect(toast(/^Scheduled for/)).toBeVisible();
  await closeAll();
});

test("Favorite and Delete (with Undo) from the viewer", async () => {
  await openAlbums();
  const favorites = await albumCount("Favorites");
  const all = await albumCount("All Photos");
  await main().getByRole("tab", { name: "Library" }).click();

  const tile = await firstTile("plain");
  const name = (await tile.getAttribute("aria-label"))!;
  await tile.click();
  await viewer().getByRole("button", { name: "Favorite", exact: true }).click();
  await expect(toast("Added to Favorites")).toBeVisible();
  await expect(viewer().getByRole("button", { name: "Unfavorite" })).toHaveAttribute("aria-pressed", "true");
  await viewer().getByRole("button", { name: "Delete" }).click();
  await expect(toast("Deleted")).toBeVisible();
  await toast("Deleted").getByRole("button", { name: "Undo" }).click();
  await page.keyboard.press("Escape");
  await expect(main().getByRole("button", { name, exact: true }).first()).toBeVisible();

  await openAlbums();
  expect(await albumCount("Favorites")).toBe(favorites + 1);
  expect(await albumCount("All Photos")).toBe(all);
  await main().getByRole("tab", { name: "Library" }).click();
});

test("Add to album: a new album, a category album changes the photo's category; rename and delete an album", async () => {
  // New album from the viewer's Add to album sheet.
  const tile = await firstTile("plain");
  await tile.click();
  await viewer().getByRole("button", { name: "Add to album", exact: true }).click();
  const albumSheet = page.getByRole("dialog", { name: "Add to album" });
  await expect(albumSheet.getByText("Category: the AI writes posts for it").first()).toBeVisible();
  await albumSheet.getByRole("button", { name: "New album" }).click();
  const nameSheet = page.getByRole("dialog", { name: "New album" });
  await nameSheet.getByRole("textbox", { name: "Album name" }).fill("Ramadan");
  await nameSheet.getByRole("button", { name: "Create album" }).click();
  await expect(toast("Added to Ramadan")).toBeVisible();

  // Moving the photo into another category album changes its category (shown under its name).
  await viewer().getByRole("button", { name: "Add to album", exact: true }).click();
  await page.getByRole("dialog", { name: "Add to album" }).getByRole("button", { name: /^Appetizers/ }).click();
  await expect(toast("Added to Appetizers")).toBeVisible();
  await expect(viewer().getByText(/^Appetizers • /)).toBeVisible();
  await page.keyboard.press("Escape");

  await openAlbums();
  await expect(albumCard("Ramadan")).toBeVisible();
  await albumCard("Ramadan").click();
  await expect(tiles()).toHaveCount(1);
  await main().getByRole("button", { name: "Album options" }).click();
  await page.getByRole("menuitem", { name: "Rename album" }).click();
  const rename = page.getByRole("dialog", { name: "Rename album" });
  await rename.getByRole("textbox").fill("Eid");
  await rename.getByRole("button", { name: "Save" }).click();
  await expect(toast("Album renamed")).toBeVisible();
  await expect(main().getByRole("heading", { name: "Eid", level: 1 })).toBeVisible();
  await main().getByRole("button", { name: "Album options" }).click();
  await page.getByRole("menuitem", { name: "Delete album" }).click();
  await expect(toast("Deleted “Eid”. Its photos are still in your library.")).toBeVisible();
  await expect(albumCard("Eid")).toHaveCount(0);
  await main().getByRole("tab", { name: "Library" }).click();
});

test("Select mode: a toolbar appears; select several and favorite them", async () => {
  await main().getByRole("button", { name: "Select", exact: true }).click();
  await expect(page.getByText("Select photos")).toBeVisible();
  const selectable = main().locator("button[aria-pressed]");
  await selectable.nth(2).click();
  await selectable.nth(3).click();
  await expect(selectable.nth(2)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("2 selected")).toBeVisible();
  for (const action of ["Create post with AI", "Add to album", "Delete"]) await expect(page.getByRole("button", { name: action, exact: true })).toBeEnabled();
  await page.getByRole("button", { name: /^(Favorite|Unfavorite)$/ }).click();
  await expect(toast(/Favorites/)).toBeVisible();
  // Done: back to the grid, the toolbar goes.
  await expect(main().getByRole("button", { name: "Select", exact: true })).toBeVisible();
  await expect(page.getByText("2 selected")).toHaveCount(0);
});

test("Upload: picks from the mock camera roll and adds to Uploads", async () => {
  await openAlbums();
  const uploads = await albumCount("Uploads");
  await main().getByRole("tab", { name: "Library" }).click();
  await main().getByRole("button", { name: "Upload" }).click();
  const sheet = page.getByRole("dialog", { name: "Upload photos" });
  await expect(sheet.getByText("Recents")).toBeVisible();
  await sheet.locator("button[aria-pressed]").first().click();
  await sheet.getByRole("button", { name: /^Upload \(1\)$/ }).click();
  await expect(toast("Uploaded 1 photo")).toBeVisible();
  await openAlbums();
  expect(await albumCount("Uploads")).toBe(uploads + 1);
  await main().getByRole("tab", { name: "Library" }).click();
});

test("Create post with AI: recognises the photo; the post matches its item; Approve moves it to Scheduled", async () => {
  await openAlbums();
  const scheduled = await albumCount("Scheduled");
  // An album no earlier test changed (moving a photo into another category album changes what the AI calls it).
  await albumCard("Family spreads").click();
  const tile = await firstTile("plain");
  const dish = (await tile.getAttribute("aria-label"))!;
  await tile.click();
  await viewer().getByRole("button", { name: "Create post with AI" }).click();
  await page.waitForURL(/\/ai$/);
  // The photo is attached with a ready prompt; one tap sends.
  await expect(page.getByRole("textbox", { name: "Ask anything…" })).toHaveValue("Create a post from this photo");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(`This looks like ${dish.toLowerCase()} from your Family spreads album.`)).toBeVisible({ timeout: 20_000 });
  // The newest post card (its buttons give way to a status line once it is approved).
  const card = page.locator("article").last();
  await expect(card.getByRole("button", { name: "Approve and schedule" })).toBeVisible();
  await expect(card.locator("bdi", { hasText: /^#/ }).first()).toBeVisible();
  await expect(card.getByText("Best time to post")).toBeVisible();
  // The caption is about this photo's item.
  await expect(card.getByText(new RegExp(dish.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")).first()).toBeVisible();
  await card.getByRole("button", { name: "Approve and schedule" }).click();
  await expect(toast(/Moved to the Scheduled album\.$/)).toBeVisible();
  await expect(card.getByRole("status")).toContainText("Scheduled for");

  await backToGallery();
  await openAlbums();
  expect(await albumCount("Scheduled")).toBe(scheduled + 1);
  await main().getByRole("tab", { name: "Library" }).click();
});

test("Save to gallery saves the post into AI Generated and its category album, without scheduling", async () => {
  await openAlbums();
  const ai = await albumCount("AI Generated");
  const scheduled = await albumCount("Scheduled");
  await albumCard("Main dishes").click();
  await (await firstTile("plain")).click();
  await viewer().getByRole("button", { name: "Create post with AI" }).click();
  await page.waitForURL(/\/ai$/);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(/from your Main dishes album\./)).toBeVisible({ timeout: 20_000 });
  const card = page.locator("article").last();
  await card.getByRole("button", { name: "Save to gallery" }).click();
  await expect(toast("Saved to AI Generated and Main dishes")).toBeVisible();
  await expect(card.getByRole("status")).toContainText("Saved");

  await backToGallery();
  await openAlbums();
  expect(await albumCount("AI Generated")).toBe(ai + 1);
  expect(await albumCount("Scheduled")).toBe(scheduled);
});

test("phone and Arabic: Photos-style grid edge to edge, viewer and albums translated, right to left", async ({ browser }) => {
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await login(phone);
  // Arabic from the profile menu (saved to the user's preferences; switched back at the end).
  const toggleLanguage = async () => {
    await phone.getByTestId("profile-menu-trigger").filter({ visible: true }).click();
    await phone.getByTestId("menu-language").click();
  };
  await toggleLanguage();
  await expect(phone.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(phone.locator("main").getByRole("tab", { name: "المكتبة" })).toBeVisible();
  const grid = phone.locator("main button[aria-label]:has(img)");
  const first = (await grid.first().boundingBox())!;
  // Three columns, the first one at the right edge (RTL), no horizontal scroll.
  expect(Math.round(first.x + first.width)).toBe(390);
  expect(Math.round(first.width)).toBeGreaterThan(125);
  expect(await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  await phone.locator("main").getByRole("tab", { name: "الألبومات" }).click();
  await expect(phone.locator("main").getByRole("heading", { name: "ألبوماتي" })).toBeVisible();
  // No footer banner above the tab bar.
  await expect(phone.getByTestId("tab-bar")).toBeVisible();
  await expect(phone.getByTestId("ai-banner")).toHaveCount(0);
  await toggleLanguage();
  await expect(phone.locator("html")).toHaveAttribute("dir", "ltr");
  await phone.close();
});
