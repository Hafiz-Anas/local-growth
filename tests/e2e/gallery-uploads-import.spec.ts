import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { expect, test, type Page } from "@playwright/test";

/**
 * The owner's photos uploaded elsewhere also go into the Gallery as Uploaded photos (lib/server/gallery-import.ts):
 * Settings → brand posts ("Noor Boutique") and onboarding "Your style" ("Fereej Bakery", in onboarding; its style
 * guide is put back afterwards). Once each: saving again adds nothing. Removing the photo from the brand posts or
 * the style picks keeps the file, because the Gallery still uses it. The one-off backfill
 * (scripts/backfill-gallery-uploads.ts) adds older uploads once: a dry run says how many, --apply adds them, a
 * second --apply adds none.
 */

const BOUTIQUE = { email: "boutique@localgrowth.dev", password: "User@123" };
const BAKERY = { email: "bakery@localgrowth.dev", password: "User@123" };
const UPLOADS = path.resolve(process.env.UPLOAD_DIR ?? "./uploads");
const photoFile = (n: string) => ({ name: `${n}.jpg`, mimeType: "image/jpeg", buffer: readFileSync(path.resolve(`public/photos/tannour/${n}.jpg`)) });

test.describe.configure({ mode: "serial", timeout: 120_000 });

let pool: Pool;
let boutiqueId: string;
let bakeryId: string;
let style: Record<string, unknown> | undefined;

async function login(p: Page, account: { email: string; password: string }) {
  await p.goto("/login");
  await p.getByLabel("Email").fill(account.email);
  await p.getByLabel("Password", { exact: true }).fill(account.password);
  await p.getByRole("button", { name: "Log in" }).click();
  await p.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/** "/api/uploads/brand-posts/<uuid>.jpg" → the file on disk (local storage). */
const fileOf = (url: string) => path.join(UPLOADS, url.replace(/^\/api\/uploads\//, ""));
const galleryRows = async (businessId: string, url: string) =>
  (await pool.query(`SELECT id, source, status, "thumbUrl" FROM "GalleryPhoto" WHERE "businessId" = $1 AND url = $2`, [businessId, url])).rows;

function backfill(apply: boolean): string {
  return execSync(`npm run backfill-gallery-uploads${apply ? " -- --apply" : ""}`, {
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL, STORAGE_PROVIDER: "local" },
    encoding: "utf8",
  });
}

test.beforeAll(async () => {
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url) || !/(e2e|test)/i.test(url)) throw new Error("Set DATABASE_URL to the local e2e database.");
  pool = new Pool({ connectionString: url.replace(/\?.*$/, "") });
  const businessOf = async (email: string) => (await pool.query<{ businessId: string }>(`SELECT "businessId" FROM "User" WHERE email = $1`, [email])).rows[0].businessId;
  boutiqueId = await businessOf(BOUTIQUE.email);
  bakeryId = await businessOf(BAKERY.email);
  style = (await pool.query(`SELECT photos, status, basis, summary, "summaryEditedAt", "failureReason" FROM "StyleGuide" WHERE "businessId" = $1`, [bakeryId])).rows[0];
});

test.afterAll(async () => {
  if (!pool) return;
  if (style) {
    await pool.query(
      `UPDATE "StyleGuide" SET photos = $2, status = $3, basis = $4, summary = $5, "summaryEditedAt" = $6, "failureReason" = $7 WHERE "businessId" = $1`,
      [bakeryId, JSON.stringify(style.photos), style.status, style.basis, style.summary, style.summaryEditedAt, style.failureReason],
    );
  } else {
    await pool.query(`DELETE FROM "StyleGuide" WHERE "businessId" = $1`, [bakeryId]);
  }
  await pool.query(`DELETE FROM "GalleryPhoto" WHERE "businessId" = $1 AND source = 'UPLOADED'`, [bakeryId]);
  await pool.end();
});

test("a brand-post photo goes into the Gallery once; removing the brand post keeps it there", async ({ browser }) => {
  const page = await browser.newPage();
  await login(page, BOUTIQUE);
  const created = await page.request.post("/api/brand/posts", { multipart: { file: photoFile("01"), purpose: "menu_product", caption: "Our cake" } });
  expect(created.status(), await created.text()).toBe(201);
  const post = (await created.json()).data as { id: string; mediaUrl: string };
  let rows = await galleryRows(boutiqueId, post.mediaUrl);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ source: "UPLOADED", status: "READY" });
  expect(rows[0].thumbUrl).toMatch(/^\/api\/uploads\/gallery-thumbs\//);

  // Shown in the Gallery like any upload.
  const gallery = (await (await page.request.get("/api/gallery")).json()).data.photos as Array<{ id: string; url: string }>;
  expect(gallery.some((p) => p.id === rows[0].id && p.url === post.mediaUrl)).toBe(true);

  // Removing the brand post keeps the photo (and its file) in the Gallery.
  expect((await page.request.delete(`/api/brand/posts/${post.id}`)).ok()).toBe(true);
  rows = await galleryRows(boutiqueId, post.mediaUrl);
  expect(rows).toHaveLength(1);
  expect(existsSync(fileOf(post.mediaUrl))).toBe(true);

  // The backfill: an older upload (its Gallery row removed to stand in for one) is added once.
  const older = await page.request.post("/api/brand/posts", { multipart: { file: photoFile("02"), purpose: "promotion", caption: "Older" } });
  const olderPost = (await older.json()).data as { id: string; mediaUrl: string };
  await pool.query(`DELETE FROM "GalleryPhoto" WHERE "businessId" = $1 AND url = $2`, [boutiqueId, olderPost.mediaUrl]);
  expect(backfill(false)).toMatch(/Noor Boutique: would add 1/);
  expect(await galleryRows(boutiqueId, olderPost.mediaUrl)).toHaveLength(0);
  expect(backfill(true)).toMatch(/Noor Boutique: added 1/);
  expect(await galleryRows(boutiqueId, olderPost.mediaUrl)).toHaveLength(1);
  const again = backfill(true);
  expect(again).not.toMatch(/Noor Boutique/);
  expect(again).toMatch(/Added 0 photo/);
  expect(await galleryRows(boutiqueId, olderPost.mediaUrl)).toHaveLength(1);

  await page.request.delete(`/api/brand/posts/${olderPost.id}`);
  await pool.query(`DELETE FROM "GalleryPhoto" WHERE "businessId" = $1 AND url = ANY($2)`, [boutiqueId, [post.mediaUrl, olderPost.mediaUrl]]);
  await page.close();
});

test("an onboarding style photo goes into the Gallery once; leaving it out of the style keeps it", async ({ browser }) => {
  const page = await browser.newPage();
  await login(page, BAKERY);
  const uploaded = await page.request.post("/api/onboarding/style/photos", { multipart: { file: photoFile("03") } });
  expect(uploaded.status(), await uploaded.text()).toBe(201);
  const { url } = (await uploaded.json()).data as { url: string };
  // Uploaded but not saved with the step yet: not in the Gallery.
  expect(await galleryRows(bakeryId, url)).toHaveLength(0);

  const save = (photos: object[]) => page.request.put("/api/onboarding/style", { data: { photos } });
  expect((await save([{ source: "upload", url }])).ok()).toBe(true);
  expect(await galleryRows(bakeryId, url)).toHaveLength(1);
  // Saving the step again adds nothing.
  expect((await save([{ source: "upload", url }])).ok()).toBe(true);
  expect(await galleryRows(bakeryId, url)).toHaveLength(1);
  // Left out of the style picks: still in the Gallery, the file kept.
  expect((await save([])).ok()).toBe(true);
  await expect.poll(async () => (await galleryRows(bakeryId, url)).length).toBe(1);
  await page.waitForTimeout(1000);
  expect(existsSync(fileOf(url))).toBe(true);
  await page.close();
});
