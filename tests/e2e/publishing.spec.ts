import { existsSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import sharp from "sharp";
import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";

/**
 * Real publishing (BE3) with mock Instagram: the seeded "Noor Boutique" (mock connection, connected for this spec
 * through the app's own connect route and put back afterwards) approves Gallery posts made from the sample photos.
 * Covers: Schedule from the Gallery → a durable job (frozen photo, the Instagram account, who approved it) shown as
 * Scheduled → the publish cron posts it with the browser closed, storing the media id and link; Post now (asks
 * first, runs without the cron); a 3-photo carousel as one post, every photo in the cover's shape; an unclear
 * media_publish answer checked against the container — posted once, never twice; rate limit waited out and retried;
 * a rejected image and a missing permission failing with their reason (Reconnect offered), Try again and Cancel;
 * a disconnected account held and posted after reconnecting, or failed when more than 6 hours late, then
 * rescheduled; the caption editable while Scheduled and locked once publishing starts; another business's posts
 * 404; publishing switched off (buttons gone, route 404, a due job fails "turned off"); admin preview read-only.
 * The mock's failure markers (#e2e_…) are documented in lib/services/instagram.mock.ts.
 * Screenshots go to E2E_SHOTS_DIR (default test-results/publishing-shots).
 */

const BOUTIQUE = { email: "boutique@localgrowth.dev", password: "User@123" };
const CAFE = { email: "cafe@localgrowth.dev", password: "User@123" };
const ADMIN = { email: "admin@localgrowth.dev", password: "Admin@123" };
const CRON_SECRET = process.env.CRON_SECRET ?? "e2e-cron";
const SHOTS = process.env.E2E_SHOTS_DIR ?? "test-results/publishing-shots";
const UPLOADS = path.resolve(process.env.UPLOAD_DIR ?? "./uploads");
const FOREIGN = {
  draft: "cforeignpubdrafte2e00001",
  job: "cforeignpubjobe2e0000001",
};

test.describe.configure({ mode: "serial", timeout: 180_000 });

let pool: Pool;
let page: Page;
let businessId: string;
let cafeId: string;
let userId: string;
let connection: { status: string; tokenExpiresAt: Date | null };

async function login(p: Page, account: { email: string; password: string }) {
  await p.goto("/login");
  await p.getByLabel("Email").fill(account.email);
  await p.getByLabel("Password", { exact: true }).fill(account.password);
  await p.getByRole("button", { name: "Log in" }).click();
  await p.waitForURL((url) => !url.pathname.startsWith("/login"));
}

const main = () => page.locator("main");
const viewer = () => page.getByRole("dialog").first();
const toast = (text: string | RegExp) => page.locator("[data-sonner-toast]").filter({ hasText: text });
const albumCard = (name: string) => main().getByRole("button", { name: new RegExp(`^${name}\\s*\\d+$`) });
const shot = (name: string, p: Page = page) => p.screenshot({ path: path.join(SHOTS, `${name}.png`) });

async function closeAll(p: Page = page) {
  for (let i = 0; i < 5 && (await p.getByRole("dialog").count()) > 0; i++) {
    await p.keyboard.press("Escape");
    await p.waitForTimeout(300);
  }
  await expect(p.getByRole("dialog")).toHaveCount(0);
}

/** A Gallery draft from sample photos (a demo business), via the API the Gallery uses. */
async function draft(photos: string[], tag: string, extra = ""): Promise<string> {
  const res = await page.request.post("/api/gallery/drafts", {
    data: {
      photoIds: photos.map((p) => `sample:${p}`),
      caption: {
        en: `Fresh today ${extra} #${tag}`.replace(/\s+/g, " "),
        ar: `طازج اليوم ${extra} #${tag}`.replace(/\s+/g, " "),
      },
      hashtags: [`#${tag}`],
      origin: "gallery",
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).data.id;
}

const approve = (draftId: string, body: object) => page.request.post(`/api/gallery/drafts/${draftId}/schedule`, { data: body });
const tomorrow = () => new Date(Date.now() + 26 * 60 * 60 * 1000).toISOString();

type Job = {
  id: string;
  status: string;
  format: string;
  mediaUrls: string[];
  mediaKeys: string[];
  igUserId: string | null;
  approvedBy: string | null;
  containerId: string | null;
  childContainerIds: string[];
  publishCallAt: Date | null;
  publishedMediaId: string | null;
  permalink: string | null;
  failureReason: string | null;
  waitingReason: string | null;
  attempts: number;
  verifyFirst: boolean;
};
async function jobOf(draftId: string): Promise<Job> {
  const rows = (await pool.query<Job>(`SELECT * FROM "ScheduledPost" WHERE "draftId" = $1 ORDER BY "approvedAt" DESC NULLS LAST LIMIT 1`, [draftId])).rows;
  expect(rows, "no job for the draft").toHaveLength(1);
  return rows[0];
}
async function waitForJob(draftId: string, check: (job: Job) => boolean, timeout = 30_000): Promise<Job> {
  const until = Date.now() + timeout;
  for (;;) {
    const job = await jobOf(draftId);
    if (check(job) || Date.now() > until) return job;
    await new Promise((r) => setTimeout(r, 500));
  }
}
/** The scheduled time (and any wait) has come — timestamps are stored in UTC. */
const makeDue = (jobId: string, minutesAgo = 1) =>
  pool.query(`UPDATE "ScheduledPost" SET "scheduledFor" = (now() AT TIME ZONE 'UTC') - make_interval(mins => $2), "nextAttemptAt" = NULL WHERE id = $1`, [
    jobId,
    minutesAgo,
  ]);
const cron = async (request: APIRequestContext) => {
  const res = await request.get("/api/cron/publish", {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()).data as {
    due: number;
    published: number;
    failed: number;
    retryLater: number;
  };
};
const published = async (jobId: string) =>
  (await pool.query(`SELECT count(*)::int AS n FROM "ActivityLog" WHERE action = 'post.published' AND details->>'scheduledPostId' = $1`, [jobId])).rows[0]
    .n as number;
const galleryPost = async (draftId: string) => {
  const res = await page.request.get("/api/gallery");
  const drafts = (await res.json()).data.drafts as Array<{
    id: string;
    post: {
      state: string;
      reason: string | null;
      permalink: string | null;
    } | null;
  }>;
  return drafts.find((d) => d.id === draftId)?.post ?? null;
};
/** Opens one photo's post (by its screen id: a demo's Drafts album also holds sample drafts). */
async function openPost(photoId: string): Promise<ReturnType<Page["getByRole"]>> {
  await closeAll();
  await main().locator(`[data-photo-id="${photoId}"]`).first().click();
  await viewer().getByRole("button", { name: "Open post" }).click();
  return page.getByRole("dialog", { name: "Ready post" }).last();
}
/** Only this spec's drafts, so the Drafts album holds just the one being tested. */
const clearDrafts = () => pool.query(`DELETE FROM "PostDraft" WHERE "businessId" = $1 AND origin <> 'GENERATOR'`, [businessId]);

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) throw new Error("Set DATABASE_URL to the local e2e database.");
  pool = new Pool({ connectionString: url.replace(/\?.*$/, "") });
  const user = (await pool.query<{ id: string; businessId: string }>(`SELECT id, "businessId" FROM "User" WHERE email = $1`, [BOUTIQUE.email])).rows[0];
  businessId = user.businessId;
  userId = user.id;
  cafeId = (await pool.query<{ businessId: string }>(`SELECT "businessId" FROM "User" WHERE email = $1`, [CAFE.email])).rows[0].businessId;
  connection = (await pool.query(`SELECT status, "tokenExpiresAt" FROM "InstagramConnection" WHERE "businessId" = $1`, [businessId])).rows[0];
  await clearDrafts();
  await pool.query(`DELETE FROM "FeaturePermission" WHERE "businessId" = $1 AND "featureKey" = 'gallery.publishing'`, [businessId]);
  // English to start with (an interrupted run may have left the saved language Arabic; login applies it).
  await pool.query(`UPDATE "User" SET "uiPreferences" = COALESCE("uiPreferences", '{}'::jsonb) || '{"language": "en"}'::jsonb WHERE id = $1`, [userId]);
  // Another business's draft and job (to try their ids).
  await pool.query(
    `INSERT INTO "PostDraft" (id, "businessId", caption, origin, "captionEn", "captionAr", status) VALUES ($1, $2, 'Theirs', 'GALLERY', 'Theirs', 'Theirs', 'QUEUED') ON CONFLICT DO NOTHING`,
    [FOREIGN.draft, cafeId],
  );
  await pool.query(
    `INSERT INTO "ScheduledPost" (id, "businessId", "draftId", "scheduledFor", status) VALUES ($1, $2, $3, (now() AT TIME ZONE 'UTC') + interval '2 days', 'SCHEDULED') ON CONFLICT DO NOTHING`,
    [FOREIGN.job, cafeId, FOREIGN.draft],
  );
  page = await browser.newPage({ viewport: { width: 1366, height: 860 } });
  await login(page, BOUTIQUE);
  // `next dev` answers requests to a dynamic route it is still compiling with an HTML 404: ask until each one answers JSON.
  const warm = async (method: "post" | "patch" | "delete", url: string) => {
    for (let i = 0; i < 30; i++) {
      const res = await page.request[method](url, { data: {} });
      if ((res.headers()["content-type"] ?? "").includes("application/json")) return;
      await page.waitForTimeout(1000);
    }
  };
  await warm("post", "/api/gallery/drafts/warmup/schedule");
  await warm("patch", "/api/scheduled-posts/warmup");
  await warm("delete", "/api/scheduled-posts/warmup");
  await warm("patch", "/api/gallery/drafts/warmup");
  // Connect the (mock) Instagram account through the app, as the owner would.
  const connected = await page.request.post("/api/instagram/connection");
  expect(connected.ok(), await connected.text()).toBe(true);
});

test.afterAll(async () => {
  await page?.close();
  if (pool) {
    await clearDrafts();
    await pool.query(`DELETE FROM "PostDraft" WHERE id = $1`, [FOREIGN.draft]);
    await pool.query(`DELETE FROM "FeaturePermission" WHERE "businessId" = $1 AND "featureKey" = 'gallery.publishing'`, [businessId]);
    await pool.query(`UPDATE "InstagramConnection" SET status = $2, "tokenExpiresAt" = $3 WHERE "businessId" = $1`, [
      businessId,
      connection.status,
      connection.tokenExpiresAt,
    ]);
    await pool.end();
  }
});

test("Schedule from the Gallery: a durable job, Scheduled everywhere; the cron posts it with the browser closed", async ({ browser, request }) => {
  const draftId = await draft(["mathanet-01"], "e2epubone");
  await page.goto("/gallery");
  const sheet = await openPost("mathanet-01");
  await sheet.getByRole("button", { name: "Schedule", exact: true }).click();
  const schedule = page.getByRole("dialog", { name: "Schedule" });
  await expect(schedule.getByTestId("schedule-note")).toContainText("even with the app closed");
  // Tomorrow at 20:30 Kuwait time.
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuwait",
  }).format(new Date(Date.now() + 24 * 60 * 60 * 1000));
  await schedule.getByLabel("Date").fill(day);
  await schedule.getByLabel("Time").fill("20:30");
  await shot("01-schedule-sheet");
  const answered = page.waitForResponse((r) => r.url().endsWith(`/api/gallery/drafts/${draftId}/schedule`) && r.request().method() === "POST");
  await schedule.getByRole("button", { name: "Schedule post" }).click();
  const response = await answered;
  expect(response.status(), await response.text()).toBe(201);
  await expect(toast(/^Scheduled for/)).toBeVisible();

  // The job: the frozen Instagram-ready photo, the account it's for and who approved it.
  let job = await jobOf(draftId);
  expect(job.status).toBe("SCHEDULED");
  expect(job.format).toBe("IMAGE");
  expect(job.mediaUrls).toHaveLength(1);
  expect(job.mediaUrls[0]).toMatch(/^\/api\/uploads\/ig-publish\/.+\.jpg$/);
  expect(job.igUserId).toBe("17841400000003");
  expect(job.approvedBy).toBe(userId);
  // Stored in UTC (read as text: the pg driver would read it in this machine's time zone).
  const scheduledFor = (await pool.query(`SELECT to_char("scheduledFor", 'YYYY-MM-DD"T"HH24:MI:SS') AS t FROM "ScheduledPost" WHERE id = $1`, [job.id])).rows[0]
    .t as string;
  expect(`${scheduledFor}.000Z`).toBe(new Date(`${day}T20:30:00+03:00`).toISOString());
  const draftRow = (await pool.query(`SELECT status, language, caption FROM "PostDraft" WHERE id = $1`, [draftId])).rows[0];
  expect(draftRow.status).toBe("QUEUED");
  expect(draftRow.caption).toContain("طازج اليوم");

  // Scheduled in the Gallery (status chip, the Scheduled collection) and in the queue.
  const again = await openPost("mathanet-01");
  await expect(again.getByTestId("post-status")).toHaveAttribute("data-state", "scheduled");
  await shot("02-post-sheet-scheduled");
  await closeAll();
  // In the Scheduled collection (a demo's sample scheduled posts are there too).
  await main().getByRole("tab", { name: "Albums" }).click();
  await albumCard("Scheduled").click();
  await expect(main().locator('[data-photo-id="mathanet-01"]')).toHaveCount(1);
  await shot("02b-scheduled-album");
  const queue = (await (await page.request.get("/api/scheduled-posts")).json()).data as Array<{
    id: string;
    state: string;
    source: string;
    photos: string[];
  }>;
  expect(queue.find((p) => p.id === job.id)).toMatchObject({
    state: "scheduled",
    source: "gallery",
  });

  // The browser closes; the time comes; the cron posts it.
  await page.close();
  await makeDue(job.id);
  const run = await cron(request);
  expect(run.published).toBeGreaterThanOrEqual(1);
  job = await jobOf(draftId);
  expect(job.status).toBe("PUBLISHED");
  expect(job.publishedMediaId).toMatch(/^ig_media_/);
  expect(job.permalink).toMatch(/^https:\/\/www\.instagram\.com\/p\//);
  expect(job.containerId).toMatch(/^mock_container_/);
  expect(await published(job.id)).toBe(1);
  expect((await pool.query(`SELECT status FROM "PostDraft" WHERE id = $1`, [draftId])).rows[0].status).toBe("PUBLISHED");
  // The frozen copy is deleted once Instagram has it.
  expect(existsSync(path.join(UPLOADS, job.mediaKeys[0]))).toBe(false);
  // A second run doesn't touch it again.
  await cron(request);
  expect(await published(job.id)).toBe(1);

  page = await browser.newPage({ viewport: { width: 1366, height: 860 } });
  await login(page, BOUTIQUE);
  expect(await galleryPost(draftId)).toMatchObject({ state: "posted" });
  await page.goto("/gallery");
  await main().getByRole("tab", { name: "Albums" }).click();
  await albumCard("Instagram").click();
  await main().locator('[data-photo-id="mathanet-01"]').click();
  await expect(viewer().getByTestId("post-status")).toHaveAttribute("data-state", "posted");
  await shot("03-viewer-posted");
  await closeAll();
  await clearDrafts();
});

test("Post now asks first, then publishes without the cron (the browser can close)", async () => {
  const draftId = await draft(["mathanet-02"], "e2epubnow");
  await page.goto("/gallery");
  const sheet = await openPost("mathanet-02");
  await sheet.getByRole("button", { name: "Post now" }).click();
  const confirm = page.getByRole("dialog", { name: "Post to Instagram now?" });
  await expect(confirm).toContainText("@noorboutique.kw");
  await shot("04-post-now-confirm");
  await confirm.getByRole("button", { name: "Post now" }).click();
  await expect(toast("Posting to Instagram now. You can close the app.")).toBeVisible();
  // after(): no cron call needed.
  const job = await waitForJob(draftId, (j) => j.status === "PUBLISHED");
  expect(job.status).toBe("PUBLISHED");
  expect(await published(job.id)).toBe(1);
  await closeAll();
  await clearDrafts();
});

test("a carousel of 3 photos is one post; every photo takes the cover's shape", async ({ request }) => {
  const draftId = await draft(["mathanet-03", "mathanet-04", "mathanet-05"], "e2epubcarousel");
  expect((await approve(draftId, { scheduledFor: tomorrow() })).status()).toBe(201);
  let job = await jobOf(draftId);
  expect(job.format).toBe("CAROUSEL");
  expect(job.mediaUrls).toHaveLength(3);
  const shapes = await Promise.all(job.mediaKeys.map(async (key) => sharp(path.join(UPLOADS, key)).metadata()));
  const ratios = shapes.map((m) => m.width! / m.height!);
  for (const r of ratios) {
    expect(Math.abs(r - ratios[0])).toBeLessThan(0.01);
    expect(r).toBeGreaterThanOrEqual(0.8 - 0.005);
    expect(r).toBeLessThanOrEqual(1.91 + 0.005);
  }
  expect(shapes.every((m) => m.format === "jpeg" && m.width! <= 1440)).toBe(true);

  await makeDue(job.id);
  await cron(request);
  job = await jobOf(draftId);
  expect(job.status).toBe("PUBLISHED");
  expect(job.childContainerIds).toHaveLength(3);
  expect(await published(job.id)).toBe(1);
  await clearDrafts();
});

test("an unclear answer from media_publish is checked against the container: posted once, never twice", async ({ request }) => {
  const draftId = await draft(["mathanet-06"], "e2epubunclear", "#e2e_publish_unclear");
  expect((await approve(draftId, { now: true })).status()).toBe(201);
  let job = await waitForJob(draftId, (j) => j.waitingReason === "uncertain");
  expect(job.status).toBe("PUBLISHING");
  expect(job.publishCallAt).not.toBeNull();
  expect(job.attempts).toBe(1);
  expect(await galleryPost(draftId)).toMatchObject({
    state: "waiting",
    reason: "uncertain",
  });
  // Owner can't cancel or move it while it's being checked.
  expect((await page.request.delete(`/api/scheduled-posts/${job.id}`)).status()).toBe(409);

  await makeDue(job.id);
  await cron(request);
  job = await jobOf(draftId);
  expect(job.status).toBe("PUBLISHED");
  // Found by its caption among the newest posts: the media id of the one post the mock made.
  expect(job.publishedMediaId).toMatch(/^ig_media_/);
  expect(await published(job.id)).toBe(1);
  // The mock refuses a second media_publish on a published container; nothing like that was logged.
  const refused = (
    await pool.query(
      `SELECT count(*)::int AS n FROM "IntegrationEvent" WHERE "businessId" = $1 AND details->>'scheduledPostId' = $2 AND "errorCode" = 'media_rejected'`,
      [businessId, job.id],
    )
  ).rows[0].n;
  expect(refused).toBe(0);
  await clearDrafts();
});

test("rate limited: waits and retries later; the owner sees what it's waiting for", async ({ request }) => {
  const draftId = await draft(["mathanet-07"], "e2epubrate", "#e2e_rate_limited");
  expect((await approve(draftId, { now: true })).status()).toBe(201);
  let job = await waitForJob(draftId, (j) => j.waitingReason === "rate_limited");
  // Nothing was sent to Instagram yet: still Scheduled (can be cancelled), waiting, one attempt used.
  expect(job.status).toBe("SCHEDULED");
  expect(job.attempts).toBe(1);
  expect(await galleryPost(draftId)).toMatchObject({
    state: "waiting",
    reason: "rate_limited",
  });
  await page.goto("/gallery");
  const sheet = await openPost("mathanet-07");
  await expect(sheet.getByTestId("post-status")).toHaveAttribute("data-state", "waiting");
  await expect(sheet.getByTestId("publish-note")).toContainText("Instagram asked us to slow down");
  await sheet.getByTestId("publish-note").scrollIntoViewIfNeeded();
  await shot("05-waiting-rate-limited");
  await closeAll();

  await makeDue(job.id);
  await cron(request);
  job = await jobOf(draftId);
  expect(job.status).toBe("PUBLISHED");
  await clearDrafts();
});

test("stuck jobs: one the scheduler never reached says it's late, then fails as missed; a run that died after media_publish is taken over and posted once", async ({ request }) => {
  // 1. The scheduler was off: due 17 hours ago and never touched since (was shown as "Publishing…" forever).
  const missed = await draft(["mathanet-07"], "e2epubstale");
  expect((await approve(missed, { scheduledFor: tomorrow() })).status()).toBe(201);
  const missedJob = await jobOf(missed);
  await pool.query(
    `UPDATE "ScheduledPost" SET "scheduledFor" = (now() AT TIME ZONE 'UTC') - interval '17 hours', "updatedAt" = (now() AT TIME ZONE 'UTC') - interval '17 hours' WHERE id = $1`,
    [missedJob.id],
  );
  expect(await galleryPost(missed)).toMatchObject({ state: "waiting", reason: "delayed" });
  await page.goto("/gallery");
  let sheet = await openPost("mathanet-07");
  await expect(sheet.getByTestId("post-status")).toHaveAttribute("data-state", "waiting");
  await expect(sheet.getByTestId("publish-note")).toContainText("running late");
  await closeAll();

  // 2. A run died right after media_publish was sent (the post is live; the lease was left behind).
  const died = await draft(["mathanet-08"], "e2epubdied", "#e2e_publish_unclear");
  expect((await approve(died, { now: true })).status()).toBe(201);
  let diedJob = await waitForJob(died, (j) => j.waitingReason === "uncertain");
  expect(diedJob.publishCallAt).not.toBeNull();
  await pool.query(
    `UPDATE "ScheduledPost" SET "leaseUntil" = (now() AT TIME ZONE 'UTC') - interval '6 minutes', "nextAttemptAt" = NULL, "waitingReason" = NULL,
       "scheduledFor" = (now() AT TIME ZONE 'UTC') - interval '10 minutes', "updatedAt" = (now() AT TIME ZONE 'UTC') - interval '9 minutes' WHERE id = $1`,
    [diedJob.id],
  );
  expect(await galleryPost(died)).toMatchObject({ state: "waiting", reason: "delayed" });
  sheet = await openPost("mathanet-08");
  await expect(sheet.getByTestId("publish-note")).toContainText("It won't be posted twice");
  await closeAll();

  const started = Date.now();
  const run = await cron(request);
  expect(Date.now() - started, "the cron answers well within cron-job.org's 30 s").toBeLessThan(25_000);
  expect(run).toMatchObject({ errors: 0 });

  // The missed one fails with its reason (offers Try again / Reschedule), instead of going out 17 hours late.
  expect(await jobOf(missed)).toMatchObject({ status: "FAILED", failureReason: "missed_window" });
  expect(await galleryPost(missed)).toMatchObject({ state: "failed", reason: "missed_window" });
  // The died one: taken over (an attempt counted), the container checked first, posted exactly once.
  diedJob = await jobOf(died);
  expect(diedJob).toMatchObject({ status: "PUBLISHED", attempts: 2 });
  expect(diedJob.publishedMediaId).toMatch(/^ig_media_/);
  expect(await published(diedJob.id)).toBe(1);
  const interrupted = (
    await pool.query(`SELECT count(*)::int AS n FROM "IntegrationEvent" WHERE details->>'scheduledPostId' = $1 AND "errorCode" = 'interrupted'`, [diedJob.id])
  ).rows[0].n;
  expect(interrupted).toBe(1);
  await clearDrafts();
});

test("a rejected image fails with its reason; the queue offers Try again; Cancel makes it a draft again", async () => {
  const draftId = await draft(["mathanet-08"], "e2epubreject", "#e2e_container_error");
  expect((await approve(draftId, { now: true })).status()).toBe(201);
  const job = await waitForJob(draftId, (j) => j.status === "FAILED");
  expect(job.failureReason).toBe("media_rejected");
  const row = (await pool.query(`SELECT status, "publishError" FROM "PostDraft" WHERE id = $1`, [draftId])).rows[0];
  expect(row).toEqual({ status: "DRAFT", publishError: "media_rejected" });
  expect(await galleryPost(draftId)).toMatchObject({
    state: "failed",
    reason: "media_rejected",
  });
  const queue = (await (await page.request.get("/api/scheduled-posts")).json()).data as Array<{ id: string; state: string; reason: string }>;
  expect(queue.find((p) => p.id === job.id)).toMatchObject({
    state: "failed",
    reason: "media_rejected",
  });

  await page.goto("/gallery");
  const sheet = await openPost("mathanet-08");
  await expect(sheet.getByTestId("post-status")).toHaveAttribute("data-state", "failed");
  await expect(sheet.getByTestId("publish-note")).toContainText("Instagram didn't accept this image");
  await expect(sheet.getByRole("button", { name: "Try again" })).toBeVisible();
  await sheet.getByTestId("publish-note").scrollIntoViewIfNeeded();
  await shot("06-failed-rejected");
  await sheet.getByRole("button", { name: "Cancel" }).click();
  await expect(toast("Schedule cancelled. The post is back in your drafts.")).toBeVisible();
  expect((await jobOf(draftId)).status).toBe("CANCELLED");
  expect((await pool.query(`SELECT status FROM "PostDraft" WHERE id = $1`, [draftId])).rows[0].status).toBe("DRAFT");
  await closeAll();
  await clearDrafts();
});

test("a missing publishing permission fails at once with Reconnect Instagram", async () => {
  const draftId = await draft(["mathanet-20"], "e2epubperm", "#e2e_no_permission");
  expect((await approve(draftId, { now: true })).status()).toBe(201);
  const job = await waitForJob(draftId, (j) => j.status === "FAILED");
  expect(job.failureReason).toBe("permission");
  await page.goto("/gallery");
  const sheet = await openPost("mathanet-20");
  const note = sheet.getByTestId("publish-note");
  await expect(note).toContainText("Instagram didn't give permission to publish");
  await expect(note.getByRole("link", { name: "Reconnect Instagram" })).toHaveAttribute("href", /\/settings/);
  await sheet.getByTestId("publish-note").scrollIntoViewIfNeeded();
  await shot("07-failed-permission");
  await closeAll();
  await clearDrafts();
});

test("Instagram disconnected: a due post waits, then posts once reconnected; more than 6 hours late it fails and can be rescheduled", async ({ request }) => {
  const held = await draft(["mathanet-10"], "e2epubheld");
  expect((await approve(held, { scheduledFor: tomorrow() })).status()).toBe(201);
  const late = await draft(["mathanet-11"], "e2epublate");
  expect((await approve(late, { scheduledFor: tomorrow() })).status()).toBe(201);
  const heldJob = await jobOf(held);
  const lateJob = await jobOf(late);

  await pool.query(`UPDATE "InstagramConnection" SET status = 'EXPIRED' WHERE "businessId" = $1`, [businessId]);
  await makeDue(heldJob.id);
  await makeDue(lateJob.id, 7 * 60);
  await cron(request);
  expect(await jobOf(held)).toMatchObject({
    status: "SCHEDULED",
    waitingReason: "not_connected",
    attempts: 0,
  });
  expect(await jobOf(late)).toMatchObject({
    status: "FAILED",
    failureReason: "not_connected",
  });
  expect(await galleryPost(held)).toMatchObject({
    state: "waiting",
    reason: "not_connected",
  });

  // Reconnecting (the app's connect route) sends the held post at the next run.
  expect((await page.request.post("/api/instagram/connection")).ok()).toBe(true);
  expect((await pool.query(`SELECT "nextAttemptAt" FROM "ScheduledPost" WHERE id = $1`, [heldJob.id])).rows[0].nextAttemptAt).toBeNull();
  await cron(request);
  expect((await jobOf(held)).status).toBe("PUBLISHED");

  // The late one: Reschedule makes it Scheduled again (nothing was sent to Instagram, so nothing to check first).
  const moved = await page.request.patch(`/api/scheduled-posts/${lateJob.id}`, {
    data: { scheduledFor: tomorrow() },
  });
  expect(moved.ok(), await moved.text()).toBe(true);
  expect((await moved.json()).data).toMatchObject({
    state: "scheduled",
    reason: null,
  });
  expect(await jobOf(late)).toMatchObject({
    status: "SCHEDULED",
    verifyFirst: false,
    failureReason: null,
  });
  expect((await pool.query(`SELECT status FROM "PostDraft" WHERE id = $1`, [late])).rows[0].status).toBe("QUEUED");
  await clearDrafts();
});

test("the caption is editable while Scheduled and locked once publishing starts", async () => {
  const draftId = await draft(["mathanet-21"], "e2epublock");
  expect((await approve(draftId, { scheduledFor: tomorrow(), language: "en" })).status()).toBe(201);
  const job = await jobOf(draftId);
  const edited = await page.request.patch(`/api/gallery/drafts/${draftId}`, {
    data: {
      caption: {
        en: "Edited while scheduled #e2epublock",
        ar: "عدّل أثناء الجدولة #e2epublock",
      },
    },
  });
  expect(edited.ok(), await edited.text()).toBe(true);
  // Approved in English: the edit keeps English as the posted caption.
  expect((await pool.query(`SELECT caption, language FROM "PostDraft" WHERE id = $1`, [draftId])).rows[0]).toEqual({
    caption: "Edited while scheduled #e2epublock",
    language: "en",
  });

  await pool.query(`UPDATE "ScheduledPost" SET status = 'PUBLISHING' WHERE id = $1`, [job.id]);
  const locked = await page.request.patch(`/api/gallery/drafts/${draftId}`, {
    data: { caption: { en: "Too late", ar: "متأخر" } },
  });
  expect(locked.status()).toBe(409);
  expect((await locked.json()).error.code).toBe("publish_started");
  expect((await page.request.delete(`/api/scheduled-posts/${job.id}`)).status()).toBe(409);
  expect(
    (
      await page.request.patch(`/api/scheduled-posts/${job.id}`, {
        data: { now: true },
      })
    ).status(),
  ).toBe(409);
  await page.goto("/gallery");
  const sheet = await openPost("mathanet-21");
  await expect(sheet.getByRole("button", { name: "Publishing to Instagram…" })).toBeDisabled();
  await expect(sheet.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await expect(sheet.getByTestId("publish-note")).toContainText("Publishing has started");
  await sheet.getByTestId("publish-note").scrollIntoViewIfNeeded();
  await shot("08-locked-publishing");
  await closeAll();

  await pool.query(`UPDATE "ScheduledPost" SET status = 'SCHEDULED' WHERE id = $1`, [job.id]);
  expect((await page.request.delete(`/api/scheduled-posts/${job.id}`)).ok()).toBe(true);
  expect((await jobOf(draftId)).status).toBe("CANCELLED");
  await clearDrafts();
});

test("another business's posts are 404; a second approval of the same draft is refused", async () => {
  expect(
    (
      await page.request.patch(`/api/scheduled-posts/${FOREIGN.job}`, {
        data: { now: true },
      })
    ).status(),
  ).toBe(404);
  expect((await page.request.delete(`/api/scheduled-posts/${FOREIGN.job}`)).status()).toBe(404);
  expect((await approve(FOREIGN.draft, { now: true })).status()).toBe(404);
  expect((await pool.query(`SELECT status FROM "ScheduledPost" WHERE id = $1`, [FOREIGN.job])).rows[0].status).toBe("SCHEDULED");

  const draftId = await draft(["mathanet-13"], "e2epubtwice");
  expect((await approve(draftId, { scheduledFor: tomorrow() })).status()).toBe(201);
  const second = await approve(draftId, { now: true });
  expect(second.status()).toBe(409);
  expect((await second.json()).error.code).toBe("already_scheduled");
  expect((await pool.query(`SELECT count(*)::int AS n FROM "ScheduledPost" WHERE "draftId" = $1`, [draftId])).rows[0].n).toBe(1);
  // A time in the past is refused.
  const other = await draft(["mathanet-14"], "e2epubpast");
  expect(
    (
      await approve(other, {
        scheduledFor: new Date(Date.now() - 60_000).toISOString(),
      })
    ).status(),
  ).toBe(400);
  await clearDrafts();
});

test("publishing switched off: the buttons are gone, the route is 404, a due job fails as turned off", async ({ request }) => {
  const due = await draft(["mathanet-15"], "e2epuboff");
  expect((await approve(due, { scheduledFor: tomorrow() })).status()).toBe(201);
  const job = await jobOf(due);
  await pool.query(
    `INSERT INTO "FeaturePermission" (id, "businessId", "featureKey", enabled) VALUES ('e2e-pub-off', $1, 'gallery.publishing', false) ON CONFLICT ("businessId", "featureKey") DO UPDATE SET enabled = false`,
    [businessId],
  );
  await pool.query(`UPDATE "Business" SET "permissionsUpdatedAt" = now() WHERE id = $1`, [businessId]);
  try {
    const other = await draft(["mathanet-16"], "e2epuboff2");
    expect((await approve(other, { now: true })).status()).toBe(404);
    await page.goto("/gallery");
    await main().getByRole("tab", { name: "Albums" }).click();
    await albumCard("Drafts").click();
    await main().locator('[data-photo-id="mathanet-16"]').click();
    await viewer().getByRole("button", { name: "Open post" }).click();
    const sheet = page.getByRole("dialog", { name: "Ready post" }).last();
    await expect(sheet.getByRole("button", { name: "Edit" })).toBeVisible();
    await expect(sheet.getByRole("button", { name: /Schedule|Post now/ })).toHaveCount(0);
    await closeAll();

    await makeDue(job.id);
    await cron(request);
    expect(await jobOf(due)).toMatchObject({
      status: "FAILED",
      failureReason: "feature_disabled",
    });
  } finally {
    await pool.query(`DELETE FROM "FeaturePermission" WHERE "businessId" = $1 AND "featureKey" = 'gallery.publishing'`, [businessId]);
    await pool.query(`UPDATE "Business" SET "permissionsUpdatedAt" = now() WHERE id = $1`, [businessId]);
    await clearDrafts();
  }
});

test("admin preview shows the statuses and changes nothing", async ({ browser }) => {
  const draftId = await draft(["mathanet-17"], "e2epubpreview");
  expect((await approve(draftId, { scheduledFor: tomorrow() })).status()).toBe(201);
  const job = await jobOf(draftId);
  const admin = await browser.newPage({
    viewport: { width: 1366, height: 860 },
  });
  await login(admin, ADMIN);
  const preview = await admin.request.get(`/api/admin/preview/${businessId}/gallery`);
  const post = (
    (await preview.json()).data.drafts as Array<{
      id: string;
      post: { state: string } | null;
    }>
  ).find((d) => d.id === draftId)?.post;
  expect(post).toMatchObject({ state: "scheduled" });
  // The client's publishing routes are the client's only.
  expect(
    (
      await admin.request.post(`/api/gallery/drafts/${draftId}/schedule`, {
        data: { now: true },
      })
    ).status(),
  ).toBe(403);
  expect((await admin.request.delete(`/api/scheduled-posts/${job.id}`)).status()).toBe(403);
  expect((await jobOf(draftId)).status).toBe("SCHEDULED");
  await admin.close();
  await clearDrafts();
});

test("phone and Arabic: the waiting note and the schedule sheet fit, right to left", async ({ browser }) => {
  const draftId = await draft(["mathanet-18"], "e2epubphone", "#e2e_rate_limited");
  expect((await approve(draftId, { now: true })).status()).toBe(201);
  await waitForJob(draftId, (j) => j.waitingReason === "rate_limited");
  const phone = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  await login(phone, BOUTIQUE);
  /** The language toggle flips EN ⇄ AR (and is saved for the user): only flip when it isn't the one wanted. */
  const language = async (dir: "rtl" | "ltr") => {
    if ((await phone.locator("html").getAttribute("dir")) !== dir) {
      await phone.getByTestId("profile-menu-trigger").filter({ visible: true }).click();
      await phone.getByTestId("menu-language").click();
    }
    await expect(phone.locator("html")).toHaveAttribute("dir", dir);
  };
  try {
    // Switched on the Gallery itself: navigating right after the switch can beat its cookie and load in English.
    await phone.goto("/gallery");
    await language("rtl");
    // It's waiting (shown as scheduled), so it's in the library, not the Drafts album.
    await phone.locator('main [data-photo-id="mathanet-18"]').click();
    await phone.getByRole("dialog").first().getByRole("button", { name: "افتح المنشور" }).click();
    const sheet = phone.getByRole("dialog").last();
    await expect(sheet.getByTestId("publish-note")).toContainText("طلب إنستغرام التمهّل");
    expect(await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await shot("09-phone-arabic-waiting", phone);
  } finally {
    // Back to English for the other specs, even when something above failed.
    await closeAll(phone);
    await language("ltr");
    await phone.close();
    await clearDrafts();
  }
});
