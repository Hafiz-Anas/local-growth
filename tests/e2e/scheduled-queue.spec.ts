import { Pool } from "pg";
import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * Scheduled posts without an experiment (BE4): a business with no posting experiment still sees its scheduled
 * posts on Best posting times, under "No experiment yet", and can cancel one (it stays cancelled after a reload).
 * Uses the seeded "Dalla & Bean": its experiment is set aside for the spec and put back afterwards, with the
 * cancelled post scheduled again.
 */

const CAFE = { email: "cafe@localgrowth.dev", password: "User@123" };

test.describe.configure({ mode: "serial" });

let pool: Pool;
let page: Page;
let businessId: string;
let experiment: Record<string, unknown> | undefined;
// The posts scheduled at the start: the spec cancels them all and schedules them again afterwards.
let scheduledIds: string[] = [];

async function login(p: Page, account: { email: string; password: string }) {
  await p.goto("/login");
  await p.getByLabel("Email").fill(account.email);
  await p.getByLabel("Password", { exact: true }).fill(account.password);
  await p.getByRole("button", { name: "Log in" }).click();
  await p.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) throw new Error("Set DATABASE_URL to the local e2e database.");
  pool = new Pool({ connectionString: url.replace(/\?.*$/, "") });
  businessId = (await pool.query<{ businessId: string }>(`SELECT "businessId" FROM "User" WHERE email = $1`, [CAFE.email])).rows[0].businessId;
  experiment = (await pool.query(`SELECT * FROM "PostingExperiment" WHERE "businessId" = $1`, [businessId])).rows[0];
  await pool.query(`DELETE FROM "PostingExperiment" WHERE "businessId" = $1`, [businessId]);
  page = await browser.newPage({ viewport: { width: 1366, height: 800 } });
  await login(page, CAFE);
});

test.afterAll(async () => {
  await page?.close();
  if (experiment) {
    const { id, startDate, dailyTarget, windows, status } = experiment;
    await pool.query(
      `INSERT INTO "PostingExperiment" (id, "businessId", "startDate", "dailyTarget", windows, status) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
      [id, businessId, startDate, dailyTarget, JSON.stringify(windows), status],
    );
  }
  if (scheduledIds.length) {
    await pool.query(`UPDATE "ScheduledPost" SET status = 'SCHEDULED' WHERE id = ANY($1)`, [scheduledIds]);
    await pool.query(`UPDATE "PostDraft" SET status = 'QUEUED' WHERE id IN (SELECT "draftId" FROM "ScheduledPost" WHERE id = ANY($1))`, [scheduledIds]);
  }
  await pool?.end();
});

test("no experiment: the scheduled posts are listed and one can be cancelled", async () => {
  scheduledIds = (await pool.query<{ id: string }>(`SELECT id FROM "ScheduledPost" WHERE "businessId" = $1 AND status = 'SCHEDULED'`, [businessId])).rows.map((r) => r.id);
  expect(scheduledIds.length).toBeGreaterThan(0);

  await page.goto("/experiment");
  await expect(page.getByText("No experiment yet")).toBeVisible();
  const queue = page.getByTestId("scheduled-queue");
  await expect(queue.getByRole("heading", { name: "Scheduled posts" })).toBeVisible();
  const rows = queue.getByRole("listitem");
  await expect(rows).toHaveCount(scheduledIds.length);

  const cancelled = page.waitForResponse((r) => /\/api\/scheduled-posts\/[^/]+$/.test(r.url()) && r.request().method() === "DELETE");
  await rows.first().getByRole("button", { name: "Remove" }).click();
  const response = await cancelled;
  expect(response.ok()).toBe(true);
  const cancelledId = new URL(response.url()).pathname.split("/").at(-1);
  await expect(rows).toHaveCount(scheduledIds.length - 1);

  await page.reload();
  await expect(page.getByTestId("scheduled-queue").getByRole("listitem")).toHaveCount(scheduledIds.length - 1);
  expect((await pool.query(`SELECT status FROM "ScheduledPost" WHERE id = $1`, [cancelledId])).rows[0].status).toBe("CANCELLED");

  // The rest cancelled too: the empty queue points to the Gallery and the AI tab (the Post Generator is hidden).
  for (let left = scheduledIds.length - 1; left > 0; left--) {
    const done = page.waitForResponse((r) => /\/api\/scheduled-posts\/[^/]+$/.test(r.url()) && r.request().method() === "DELETE");
    await page.getByTestId("scheduled-queue").getByRole("listitem").first().getByRole("button", { name: "Remove" }).click();
    expect((await done).ok()).toBe(true);
  }
  await page.reload();
  await expect(page.getByTestId("scheduled-queue")).toContainText("Nothing scheduled");
  await expect(page.getByTestId("scheduled-queue")).toContainText("Create a post from the Gallery or the AI tab, then schedule it.");
  await expect(page.getByTestId("scheduled-queue")).not.toContainText("Post Generator");

  // Phone width: the queue fits without a horizontal scroll.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("scheduled-queue")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
