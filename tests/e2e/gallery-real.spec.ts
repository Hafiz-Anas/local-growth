import { readFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { startGeminiStub } from "./gemini-stub";

/**
 * The Gallery and AI post drafts for a real business (BE1, BE2, BE5, UX5): the seeded "Noor Boutique" is made a
 * real business for this spec (its Instagram connection's provider set to META; put back afterwards) and its
 * Gallery is emptied. It sees no sample photos, chats or category albums; an empty Gallery says "Upload your first
 * photos"; real uploads (one and several, a non-photo refused) are stored and come back after a reload and on
 * another device with their favourites and albums; Delete has Undo; synced Instagram posts are only hidden; the AI
 * writes captions from the photo (Gemini stub), Regenerate keeps earlier captions, drafts survive a reload and can
 * be edited again; invented numbers are never shown; Approve / Post now / Schedule say publishing comes next;
 * another business's photos, albums, drafts and uploads are 404; admin preview is read-only. Rows it adds for
 * "Dalla & Bean" (to try another business's ids) are removed at the end.
 */

const BOUTIQUE = { email: "boutique@localgrowth.dev", password: "User@123" };
const CAFE = { email: "cafe@localgrowth.dev", password: "User@123" };
const ADMIN = { email: "admin@localgrowth.dev", password: "Admin@123" };
// Another business's rows (cuid-shaped ids, so they pass the id format check and reach the business check).
const FOREIGN = { photo: "cforeignphotoe2e00000001", upload: "cforeignuploade2e0000001", album: "cforeignalbume2e00000001", draft: "cforeigndrafte2e00000001" };
const PHOTO = (n: string) => path.resolve(`public/photos/tannour/${n}.jpg`);
const photoFile = (n: string) => ({ name: `${n}.jpg`, mimeType: "image/jpeg", buffer: readFileSync(PHOTO(n)) });

test.describe.configure({ mode: "serial", timeout: 120_000 });

let pool: Pool;
let stub: Awaited<ReturnType<typeof startGeminiStub>>;
let page: Page;
let businessId: string;
let cafeId: string;
let provider: string;

async function login(p: Page, account: { email: string; password: string }) {
  await p.goto("/login");
  await p.getByLabel("Email").fill(account.email);
  await p.getByLabel("Password", { exact: true }).fill(account.password);
  await p.getByRole("button", { name: "Log in" }).click();
  await p.waitForURL((url) => !url.pathname.startsWith("/login"));
}

const main = () => page.locator("main");
const tiles = () => main().locator("button[aria-label]:has(img)");
const viewer = () => page.getByRole("dialog").first();
const toast = (text: string | RegExp) => page.locator("[data-sonner-toast]").filter({ hasText: text });
const albumCard = (name: string) => main().getByRole("button", { name: new RegExp(`^${name}\\s*\\d+$`) });
const albumCount = async (name: string) => Number((await albumCard(name).innerText()).match(/(\d+)\s*$/)![1]);
async function closeAll() {
  for (let i = 0; i < 5 && (await page.getByRole("dialog").count()) > 0; i++) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 10_000 });
}
async function openAlbums() {
  await closeAll();
  await main().getByRole("tab", { name: "Albums" }).click();
}
const businessOf = async (email: string) => (await pool.query<{ businessId: string }>(`SELECT "businessId" FROM "User" WHERE email = $1`, [email])).rows[0].businessId;

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) throw new Error("Set DATABASE_URL to the local e2e database.");
  pool = new Pool({ connectionString: url.replace(/\?.*$/, "") });
  businessId = await businessOf(BOUTIQUE.email);
  cafeId = await businessOf(CAFE.email);
  provider = (await pool.query<{ provider: string }>(`SELECT provider FROM "InstagramConnection" WHERE "businessId" = $1`, [businessId])).rows[0].provider;
  // A clean, real (non-demo) Gallery.
  await pool.query(`DELETE FROM "PostDraft" WHERE "businessId" = $1 AND origin <> 'GENERATOR'`, [businessId]);
  await pool.query(`DELETE FROM "GalleryAlbum" WHERE "businessId" = $1`, [businessId]);
  await pool.query(`DELETE FROM "GalleryPhoto" WHERE "businessId" = $1`, [businessId]);
  await pool.query(`DELETE FROM "InstagramMedia" WHERE "businessId" = $1`, [businessId]);
  await pool.query(`UPDATE "InstagramConnection" SET provider = 'META' WHERE "businessId" = $1`, [businessId]);
  // Dalla & Bean's own photo, a pending upload, an album and a draft.
  await pool.query(
    `INSERT INTO "GalleryPhoto" (id, "businessId", source, status, url, "updatedAt") VALUES ($1, $3, 'UPLOADED', 'READY', '/photos/qahwa/04.jpg', now()), ($2, $3, 'UPLOADED', 'PENDING', NULL, now()) ON CONFLICT DO NOTHING`,
    [FOREIGN.photo, FOREIGN.upload, cafeId],
  );
  await pool.query(`INSERT INTO "GalleryAlbum" (id, "businessId", name) VALUES ($1, $2, 'Theirs') ON CONFLICT DO NOTHING`, [FOREIGN.album, cafeId]);
  await pool.query(`INSERT INTO "PostDraft" (id, "businessId", caption, origin, "captionEn", "captionAr") VALUES ($1, $2, 'Theirs', 'GALLERY', 'Theirs', 'Theirs') ON CONFLICT DO NOTHING`, [FOREIGN.draft, cafeId]);
  await pool.query(`INSERT INTO "PostDraftPhoto" ("draftId", "photoId") VALUES ($1, $2) ON CONFLICT DO NOTHING`, [FOREIGN.draft, FOREIGN.photo]);
  stub = await startGeminiStub();
  page = await browser.newPage({ viewport: { width: 1366, height: 860 } });
  await login(page, BOUTIQUE);
});

test.afterAll(async () => {
  await page?.close();
  await stub?.close();
  if (pool) {
    await pool.query(`UPDATE "InstagramConnection" SET provider = $2 WHERE "businessId" = $1`, [businessId, provider]);
    await pool.query(`DELETE FROM "InstagramMedia" WHERE "businessId" = $1`, [businessId]);
    await pool.query(`DELETE FROM "PostDraft" WHERE id = $1`, [FOREIGN.draft]);
    await pool.query(`DELETE FROM "GalleryAlbum" WHERE id = $1`, [FOREIGN.album]);
    await pool.query(`DELETE FROM "GalleryPhoto" WHERE id = ANY($1)`, [[FOREIGN.photo, FOREIGN.upload]]);
    await pool.end();
  }
});

test("a real business sees only its own Gallery: the empty state, no sample photos, chats or category albums", async () => {
  await page.goto("/gallery");
  await expect(main().getByRole("heading", { name: "Upload your first photos" })).toBeVisible();
  await expect(main().getByText("Add photos from your phone or computer. The AI turns them into posts.")).toBeVisible();
  await expect(main().getByRole("button", { name: "Upload photos" })).toBeVisible();
  await expect(tiles()).toHaveCount(0);
  const gallery = (await (await page.request.get("/api/gallery")).json()).data;
  expect(gallery).toMatchObject({ demo: false, photos: [], albums: [], drafts: [] });

  await openAlbums();
  for (const name of ["All Photos", "Uploads", "Instagram", "Drafts", "AI Generated", "Favorites"]) await expect(albumCard(name)).toBeVisible();
  // Nothing is scheduled until publishing is connected; category albums are the demo's samples.
  await expect(albumCard("Scheduled")).toHaveCount(0);
  await expect(albumCard("Sweets")).toHaveCount(0);
  await main().getByRole("tab", { name: "Library" }).click();

  // The AI tab: no sample chats; a post needs photos first.
  await page.goto("/ai");
  // Wait for the page to be interactive (a tap before hydration does nothing).
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "What would you like to do?" })).toBeVisible();
  await expect(page.getByTestId("chat-item")).toHaveCount(0);
  await page.getByTestId("shortcut-card-post").click();
  await expect(page.getByText("Upload a few photos to your Gallery first, then I'll turn them into posts.")).toBeVisible();
});

test("upload one photo, then several (a non-photo is refused with the reason); stored, with thumbnails, after a reload", async () => {
  await page.goto("/gallery");
  await main().getByRole("button", { name: "Upload photos" }).click();
  const sheet = page.getByRole("dialog", { name: "Upload photos" });
  await expect(sheet.getByText("JPG, PNG or WebP, up to 30 at a time. Big photos are made smaller before they're sent.")).toBeVisible();
  await sheet.getByTestId("gallery-file-input").setInputFiles(PHOTO("01"));
  // The first upload also waits for `next dev` to compile the upload routes.
  await expect(toast("Uploaded 1 photo")).toBeVisible({ timeout: 90_000 });
  await expect(tiles()).toHaveCount(1);
  await expect(main().getByRole("heading", { name: "Upload your first photos" })).toHaveCount(0);

  await closeAll();
  await main().getByRole("button", { name: "Upload" }).click();
  await page
    .getByRole("dialog", { name: "Upload photos" })
    .getByTestId("gallery-file-input")
    .setInputFiles([photoFile("02"), photoFile("03"), { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not a photo") }]);
  await expect(toast("Uploaded 2 photos")).toBeVisible({ timeout: 30_000 });
  await expect(toast("“notes.txt” wasn't uploaded: use a JPG, PNG or WebP photo.")).toBeVisible();
  await expect(tiles()).toHaveCount(3);
  await expect(main().locator('span[title="Uploaded by you"]')).toHaveCount(3);
  await expect(main().locator('span[title*="Sample"]')).toHaveCount(0);

  // Stored for this business, checked on the server: dimensions read, a thumbnail made.
  const rows = (await pool.query(`SELECT url, "thumbUrl", status, source, width, height, bytes FROM "GalleryPhoto" WHERE "businessId" = $1 AND "removedAt" IS NULL`, [businessId])).rows;
  expect(rows).toHaveLength(3);
  for (const row of rows) {
    expect(row).toMatchObject({ status: "READY", source: "UPLOADED" });
    expect(row.url).toMatch(/^\/api\/uploads\/gallery\/[a-f0-9-]{36}\.jpg$/);
    expect(row.thumbUrl).toMatch(/^\/api\/uploads\/gallery-thumbs\/[a-f0-9-]{36}\.webp$/);
    expect(row.width).toBeGreaterThan(0);
  }
  expect((await page.request.get(rows[0].thumbUrl)).ok()).toBe(true);
  await page.reload();
  await expect(tiles()).toHaveCount(3);
});

test("the server checks the bytes too: a fake photo is refused and nothing is kept", async () => {
  const [ticket] = (await (await page.request.post("/api/gallery/uploads", { data: { files: [{ name: "fake.jpg", type: "image/jpeg", size: 11 }] } })).json()).data;
  expect(ticket).toMatchObject({ mode: "local", token: null });
  const put = await page.request.put(ticket.uploadUrl, { multipart: { file: { name: "fake.jpg", mimeType: "image/jpeg", buffer: Buffer.from("not a photo") } } });
  expect(put.status()).toBe(415);
  const complete = await page.request.post(`/api/gallery/uploads/${ticket.id}/complete`, { data: { url: "/api/uploads/gallery/00000000-0000-0000-0000-000000000000.jpg" } });
  expect(complete.status()).toBe(422);
  expect((await complete.json()).error).toMatchObject({ code: "upload_invalid", details: [{ path: "reason", message: "missing" }] });
  expect((await pool.query(`SELECT 1 FROM "GalleryPhoto" WHERE id = $1`, [ticket.id])).rowCount).toBe(0);
});

test("favourites, albums and Delete (with Undo) are saved: after a reload and on another device", async ({ browser }) => {
  await page.goto("/gallery");
  await tiles().first().click();
  await viewer().getByRole("button", { name: "Favorite", exact: true }).click();
  await expect(toast("Added to Favorites")).toBeVisible();
  await viewer().getByRole("button", { name: "Add to album", exact: true }).click();
  await page.getByRole("dialog", { name: "Add to album" }).getByRole("button", { name: "New album" }).click();
  const nameSheet = page.getByRole("dialog", { name: "New album" });
  await nameSheet.getByRole("textbox", { name: "Album name" }).fill("Weekend");
  await nameSheet.getByRole("button", { name: "Create album" }).click();
  await expect(toast("Added to Weekend")).toBeVisible();

  // Another device (its own browser) sees the same.
  const other = await browser.newPage();
  await login(other, BOUTIQUE);
  await other.goto("/gallery");
  await other.locator("main").getByRole("tab", { name: "Albums" }).click();
  await expect(other.locator("main").getByRole("button", { name: /^Weekend\s*1$/ })).toBeVisible();
  await expect(other.locator("main").getByRole("button", { name: /^Favorites\s*1$/ })).toBeVisible();
  await other.close();

  // Delete, then Undo: still there after a reload.
  await closeAll();
  await tiles().nth(1).click();
  await viewer().getByRole("button", { name: "Delete", exact: true }).click();
  await toast("Deleted").getByRole("button", { name: "Undo" }).click();
  await closeAll();
  await page.reload();
  await expect(tiles()).toHaveCount(3);

  // Delete for good from the select toolbar.
  await main().getByRole("button", { name: "Select", exact: true }).click();
  await main().locator("button[aria-pressed]").nth(2).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(toast("Deleted")).toBeVisible();
  await page.reload();
  await expect(tiles()).toHaveCount(2);
  expect((await pool.query(`SELECT 1 FROM "GalleryPhoto" WHERE "businessId" = $1 AND "removedAt" IS NOT NULL AND source = 'UPLOADED'`, [businessId])).rowCount).toBe(1);
  await openAlbums();
  expect(await albumCount("All Photos")).toBe(2);
  expect(await albumCount("Favorites")).toBe(1);
  await main().getByRole("tab", { name: "Library" }).click();
});

test("Instagram posts from the sync show in the Instagram album; 'Hide from Gallery' hides them here only", async () => {
  await pool.query(
    `INSERT INTO "InstagramMedia" (id, "businessId", "igMediaId", caption, "mediaType", "mediaProductType", "mediaUrl", permalink, "postedAt", "likeCount", "commentsCount", insights)
     VALUES ('e2e-media-1', $1, 'e2e-ig-1', 'Fresh manakish this morning #fereej', 'IMAGE', 'FEED', '/photos/tannour/05.jpg', 'https://www.instagram.com/p/e2e1/', now() - interval '2 days', 12, 3, '{"reach": 240, "saved": 4, "shares": 2}'),
            ('e2e-media-2', $1, 'e2e-ig-2', 'Zaatar and cheese', 'IMAGE', 'FEED', '/photos/tannour/06.jpg', 'https://www.instagram.com/p/e2e2/', now() - interval '3 days', 8, 1, '{}')`,
    [businessId],
  );
  await page.goto("/gallery");
  await openAlbums();
  expect(await albumCount("Instagram")).toBe(2);
  await albumCard("Instagram").click();
  await expect(main().locator('span[title="Instagram"]')).toHaveCount(2);
  await tiles().first().click();
  await expect(viewer().getByRole("heading", { name: "Ready post" })).toBeVisible();
  await expect(viewer().getByText("Fresh manakish this morning")).toBeVisible();
  await expect(viewer().getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
  await viewer().getByRole("button", { name: "Open post" }).click();
  const sheet = page.getByRole("dialog", { name: "Ready post" }).last();
  await expect(sheet.getByRole("link", { name: "View on Instagram" })).toHaveAttribute("href", "https://www.instagram.com/p/e2e1/");
  // A posted Instagram post isn't edited here.
  await expect(sheet.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await viewer().getByRole("button", { name: "Hide from Gallery" }).click();
  await expect(toast("Hidden from your Gallery. Nothing changed on Instagram.")).toBeVisible();
  await page.reload();
  await main().getByRole("tab", { name: "Albums" }).click();
  expect(await albumCount("Instagram")).toBe(1);
  // Nothing changed on Instagram (or in the synced data).
  expect((await pool.query(`SELECT 1 FROM "InstagramMedia" WHERE "businessId" = $1`, [businessId])).rowCount).toBe(2);
  await main().getByRole("tab", { name: "Library" }).click();
});

test("the AI writes the caption from the photo; Regenerate keeps earlier captions; the draft survives a reload and is edited again", async () => {
  await page.goto("/gallery");
  await openAlbums();
  await albumCard("Uploads").click();
  await tiles().first().click();
  await viewer().getByRole("button", { name: "Create post with AI" }).click();
  await page.waitForURL(/\/ai$/);
  await page.getByRole("button", { name: "Send" }).click();
  const card = page.locator("article").last();
  await expect(card.getByTestId("post-caption")).toHaveText("Stub caption (base) for your photo.", { timeout: 20_000 });
  // The model saw the photo itself.
  expect(stub.state.captionImages).toBe(1);
  await expect(card.getByText("#stubcaption")).toBeVisible();
  // No sample "AI images" for a real business in this phase.
  await expect(card.getByRole("radiogroup")).toHaveCount(0);

  await card.getByRole("button", { name: "Regenerate" }).click();
  await card.getByRole("button", { name: "Shorter" }).click();
  await expect(card.getByTestId("post-caption")).toHaveText("Stub caption (shorter) for your photo.");
  await expect(card.getByTestId("caption-versions")).toContainText("Earlier captions (1)");
  await card.getByRole("button", { name: "Save to gallery" }).click();
  await expect(toast("Saved as a draft. Find it in Drafts.")).toBeVisible();
  await expect(card.getByRole("status")).toBeVisible();

  const draft = (await pool.query(`SELECT "captionEn", "captionAr", hashtags, "captionVersions", "suggestedFor", origin FROM "PostDraft" WHERE "businessId" = $1 AND origin = 'AI_CHAT'`, [businessId])).rows;
  expect(draft).toHaveLength(1);
  expect(draft[0].captionEn).toContain("Stub caption (shorter) for your photo.");
  expect(draft[0].captionEn).toContain("#stubcaption");
  expect(draft[0].captionAr).toContain("وصف تجريبي (shorter)");
  expect(draft[0].captionVersions).toHaveLength(1);
  expect(draft[0].captionVersions[0].en).toContain("(base)");
  expect(draft[0].suggestedFor).not.toBeNull();

  // In the Gallery, after a reload: the Drafts album, the caption, editable again.
  await page.goto("/gallery");
  await openAlbums();
  expect(await albumCount("Drafts")).toBe(1);
  await albumCard("Drafts").click();
  await tiles().first().click();
  await expect(viewer().getByText("Stub caption (shorter) for your photo.")).toBeVisible();
  await viewer().getByRole("button", { name: "Open post" }).click();
  let sheet = page.getByRole("dialog", { name: "Ready post" }).last();
  await sheet.getByRole("button", { name: "Edit" }).click();
  await sheet.getByRole("textbox", { name: "Caption" }).fill("Weekend manakish, fresh from our oven. #stubcaption");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(toast("Caption saved")).toBeVisible();
  await page.reload();
  await main().getByRole("tab", { name: "Albums" }).click();
  await albumCard("Drafts").click();
  await tiles().first().click();
  await viewer().getByRole("button", { name: "Open post" }).click();
  sheet = page.getByRole("dialog", { name: "Ready post" }).last();
  await expect(sheet.getByText("Weekend manakish, fresh from our oven.")).toBeVisible();

  // Publishing isn't connected yet: Post now and Schedule say so; the time is kept with the draft.
  await sheet.getByRole("button", { name: "Post now" }).click();
  await expect(toast("Publishing is coming next. Your post is saved as a draft.")).toBeVisible();
  await sheet.getByRole("button", { name: "Schedule" }).click();
  const schedule = page.getByRole("dialog", { name: "Schedule" });
  await expect(schedule.getByTestId("schedule-note")).toBeVisible();
  // Only the draft's own suggested time (no sample "best times"), plus a time of your own.
  await expect(schedule.getByRole("radio")).toHaveCount(2);
  await schedule.getByRole("button", { name: "Save time" }).click();
  await expect(toast("Publishing is coming next. The time is saved with your draft.")).toBeVisible();
  await closeAll();
});

test("an answer with invented numbers or claims is never shown: the neutral caption about the business instead; Approve says publishing comes next", async () => {
  const scheduled = async () => (await pool.query(`SELECT 1 FROM "ScheduledPost" WHERE "businessId" = $1`, [businessId])).rowCount;
  const scheduledBefore = await scheduled();
  await page.goto("/ai");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Attach photos" }).click();
  const picker = page.getByRole("dialog").last();
  await picker.locator("button[aria-pressed]").first().click();
  await picker.getByRole("button", { name: "Attach (1)" }).click();
  await page.getByRole("textbox", { name: "Ask anything…" }).fill("[invent] weekend offer");
  await page.getByRole("button", { name: "Send" }).click();
  const card = page.locator("article").last();
  await expect(card.getByTestId("post-caption")).toContainText("Noor Boutique", { timeout: 20_000 });
  await expect(card.getByTestId("post-caption")).not.toContainText("3.5");
  await expect(card.getByText("The AI isn't available right now, so here's a simple caption to start from. Edit it before posting.")).toBeVisible();
  await card.getByRole("button", { name: "Approve and schedule" }).click();
  await expect(toast("Publishing is coming next. Your post is saved as a draft.")).toBeVisible();
  await expect(card.getByRole("status")).toBeVisible();
  // Nothing was scheduled.
  expect(await scheduled()).toBe(scheduledBefore);
});

test("another business's photos, albums, drafts and uploads are 404; sample photos never belong to a real business", async ({ browser }) => {
  const r = page.request;
  const expect404 = async (response: Promise<{ status(): number }>, what: string) => expect((await response).status(), what).toBe(404);
  await expect404(r.post("/api/gallery/favorites", { data: { ids: [FOREIGN.photo], value: true } }), "favourite");
  await expect404(r.post("/api/gallery/remove", { data: { ids: [FOREIGN.photo] } }), "remove");
  await expect404(r.post("/api/gallery/restore", { data: { ids: [FOREIGN.photo] } }), "restore");
  await expect404(r.post("/api/gallery/albums", { data: { name: "Mine", photoIds: [FOREIGN.photo] } }), "album with their photo");
  await expect404(r.patch(`/api/gallery/albums/${FOREIGN.album}`, { data: { name: "Mine now" } }), "rename their album");
  await expect404(r.delete(`/api/gallery/albums/${FOREIGN.album}`), "delete their album");
  await expect404(r.post(`/api/gallery/albums/${FOREIGN.album}/photos`, { data: { ids: [FOREIGN.photo] } }), "add to their album");
  await expect404(r.patch(`/api/gallery/drafts/${FOREIGN.draft}`, { data: { caption: { en: "x", ar: "x" } } }), "edit their draft");
  await expect404(r.delete(`/api/gallery/drafts/${FOREIGN.draft}`), "delete their draft");
  await expect404(r.post("/api/gallery/drafts", { data: { photoIds: [FOREIGN.photo], caption: { en: "x", ar: "x" } } }), "draft with their photo");
  await expect404(r.post("/api/gallery/caption", { data: { photoIds: [FOREIGN.photo] } }), "caption for their photo");
  await expect404(r.put(`/api/gallery/uploads/${FOREIGN.upload}`, { multipart: { file: { name: "a.jpg", mimeType: "image/jpeg", buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00]) } } }), "send their upload");
  await expect404(r.post(`/api/gallery/uploads/${FOREIGN.upload}/complete`, { data: { url: "/api/uploads/gallery/x.jpg" } }), "finish their upload");
  // Sample photos are a demo business's only.
  await expect404(r.post("/api/gallery/favorites", { data: { ids: ["sample:mathanet-07"], value: true } }), "sample photo");
  const own = (await (await r.get("/api/gallery")).json()).data;
  expect(JSON.stringify(own)).not.toContain(FOREIGN.photo);
  // Their rows didn't change.
  const theirs = (await pool.query(`SELECT p.favorite, a.name, d."captionEn" FROM "GalleryPhoto" p, "GalleryAlbum" a, "PostDraft" d WHERE p.id = $1 AND a.id = $2 AND d.id = $3`, [FOREIGN.photo, FOREIGN.album, FOREIGN.draft])).rows[0];
  expect(theirs).toEqual({ favorite: false, name: "Theirs", captionEn: "Theirs" });

  // The other way round: the café can't touch this business's photo.
  const mine = own.photos.find((p: { source: string }) => p.source === "upload").id as string;
  const cafe = await browser.newPage();
  await login(cafe, CAFE);
  expect((await cafe.request.post("/api/gallery/favorites", { data: { ids: [mine], value: true } })).status()).toBe(404);
  await cafe.close();
  // Signed out: 401.
  const anon = await browser.newContext();
  expect((await anon.request.get("/api/gallery")).status()).toBe(401);
  await anon.close();
});

test("admin preview is read-only: the Gallery shows, changes are refused", async ({ browser }) => {
  const admin = await browser.newPage({ viewport: { width: 1366, height: 860 } });
  await login(admin, ADMIN);
  const preview = await admin.request.get(`/api/admin/preview/${businessId}/gallery`);
  expect(preview.ok()).toBe(true);
  expect((await preview.json()).data.photos.length).toBeGreaterThan(0);
  // The client APIs are the client's only.
  expect((await admin.request.post("/api/gallery/favorites", { data: { ids: ["clx1a2b3c4d5e6f7g8h9i0jk"], value: true } })).status()).toBe(403);

  await admin.goto(`/admin/clients/${businessId}`);
  await admin.getByRole("button", { name: "Preview as this client" }).click();
  await admin.waitForURL(/\/gallery$/);
  const grid = admin.locator("main button[aria-label]:has(img)");
  await expect(grid.first()).toBeVisible();
  const before = (await pool.query(`SELECT count(*)::int AS n FROM "GalleryPhoto" WHERE "businessId" = $1 AND favorite`, [businessId])).rows[0].n;
  await grid.last().click();
  await admin.getByRole("dialog").getByRole("button", { name: /^(Favorite|Unfavorite)$/ }).click();
  await expect(admin.getByText("Preview is read-only — changes are made by the client.")).toBeVisible();
  expect((await pool.query(`SELECT count(*)::int AS n FROM "GalleryPhoto" WHERE "businessId" = $1 AND favorite`, [businessId])).rows[0].n).toBe(before);
  await admin.keyboard.press("Escape");
  await admin.getByRole("button", { name: "Exit preview" }).click();
  await admin.waitForURL(/\/admin/);
  await admin.close();
});

test("phone and Arabic: the upload sheet and the Hide label are translated, right to left, nothing scrolls sideways", async ({ browser }) => {
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await login(phone, BOUTIQUE);
  const toggleLanguage = async () => {
    await phone.getByTestId("profile-menu-trigger").filter({ visible: true }).click();
    await phone.getByTestId("menu-language").click();
  };
  await phone.goto("/gallery");
  await toggleLanguage();
  await expect(phone.locator("html")).toHaveAttribute("dir", "rtl");
  await phone.locator("main").getByRole("button", { name: "رفع" }).click();
  const sheet = phone.getByRole("dialog", { name: "رفع صور" });
  await expect(sheet.getByRole("button", { name: "اختيار الصور" })).toBeVisible();
  await expect(sheet.getByText("JPG أو PNG أو WebP، حتى ٣٠ صورة في كل مرة.", { exact: false })).toBeVisible();
  await phone.keyboard.press("Escape");
  await phone.locator("main").getByRole("tab", { name: "الألبومات" }).click();
  await phone.locator("main").getByRole("button", { name: /^إنستغرام/ }).click();
  await phone.locator("main button[aria-label]:has(img)").first().click();
  await expect(phone.getByRole("dialog").getByRole("button", { name: "إخفاء من المعرض" })).toBeVisible();
  expect(await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  await phone.keyboard.press("Escape");
  await toggleLanguage();
  await expect(phone.locator("html")).toHaveAttribute("dir", "ltr");
  await phone.close();
});
