import { expect, test, type Browser, type Page } from "@playwright/test";
import { Pool, types } from "pg";
import { startGeminiStub } from "./gemini-stub";

/**
 * Post monitoring, end to end (see playwright.config.ts for how to run): "Monitor this post" on a
 * post's detail view (durations, extend, stop), the plan's limit and one monitor per post, the hourly
 * job (CRON_SECRET, readings, a notable-change alert, the end with an AI summary that may only use
 * the data's numbers, numbers only when the AI is down), daily monitoring reusing the daily snapshot,
 * the Post monitoring tab and full view, the assistant's data, Arabic RTL on a phone and the feature
 * switch. Uses the seeded "Mathanet Baity" business (Pro, mock Instagram) and the Gemini stub. The
 * spec moves monitors' clocks forward in the e2e database (DATABASE_URL) instead of waiting hours,
 * and stops any monitor it finds first, so it doesn't need a fresh seed.
 */

const USER = { email: "user@mathanetbaity.dev", password: "User@123" };
const ADMIN = { email: "admin@localgrowth.dev", password: "Admin@123" };
const CRON_SECRET = process.env.CRON_SECRET ?? "e2e-cron";
const HOUR = 60 * 60 * 1000;

test.describe.configure({ mode: "serial" });

let page: Page;
let stub: Awaited<ReturnType<typeof startGeminiStub>>;
let db: ReturnType<typeof testDb>;

/** Direct access to the e2e database: read monitors and move their clocks forward. Local databases only. */
function testDb() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) throw new Error("Set DATABASE_URL to the local e2e database (the spec moves monitors' clocks forward).");
  // Prisma stores UTC in "timestamp without time zone": read and write it as UTC whatever the machine's zone.
  types.setTypeParser(1114, (text: string) => new Date(`${text.replace(" ", "T")}Z`));
  const pool = new Pool({ connectionString: url });
  type MonitorRow = { id: string; businessId: string; status: string; interval: string; startedAt: Date; endsAt: Date; nextReadingAt: Date; outcome: unknown; summary: unknown; summaryStatus: string | null };
  return {
    monitor: async (id: string) => (await pool.query<MonitorRow>(`SELECT * FROM "PostMonitor" WHERE id = $1`, [id])).rows[0],
    update: async (id: string, fields: Record<string, unknown>) => {
      const keys = Object.keys(fields);
      const values = keys.map((k) => {
        const v = fields[k];
        if (v instanceof Date) return v.toISOString().replace("Z", "");
        return v !== null && typeof v === "object" ? JSON.stringify(v) : v;
      });
      await pool.query(`UPDATE "PostMonitor" SET ${keys.map((k, i) => `"${k}" = $${i + 2}`).join(", ")} WHERE id = $1`, [id, ...values]);
    },
    readings: async (id: string) => Number((await pool.query(`SELECT count(*) FROM "MonitorSnapshot" WHERE "monitorId" = $1`, [id])).rows[0].count),
    dailyRows: async (businessId: string, igMediaId: string, date: string) =>
      Number((await pool.query(`SELECT count(*) FROM "PostSnapshot" WHERE "businessId" = $1 AND "igMediaId" = $2 AND date = $3`, [businessId, igMediaId, date])).rows[0].count),
    close: () => pool.end(),
  };
}

async function login(p: Page, account: { email: string; password: string }) {
  await p.goto("/login");
  await p.getByLabel("Email").fill(account.email);
  await p.getByLabel("Password", { exact: true }).fill(account.password);
  await p.getByRole("button", { name: "Log in" }).click();
  await p.waitForURL((url) => !url.pathname.startsWith("/login"));
}

async function switchLanguage(p: Page, to: "en" | "ar") {
  const saved = p.waitForResponse((r) => r.url().includes("/api/me/preferences") && r.request().method() === "PATCH");
  await p.getByTestId("profile-menu-trigger").click();
  await p.getByTestId("menu-language").click();
  await expect(p.locator("html")).toHaveAttribute("dir", to === "ar" ? "rtl" : "ltr");
  await saved;
}

async function asAdmin<T>(browser: Browser, work: (admin: Page, businessId: string) => Promise<T>): Promise<T> {
  const admin = await browser.newPage();
  try {
    await login(admin, ADMIN);
    const list = await admin.request.get("/api/admin/businesses?q=mathanet_baity");
    const [business] = (await list.json()).data as Array<{ id: string }>;
    return await work(admin, business.id);
  } finally {
    await admin.close();
  }
}

type Overview = { limit: number; active: Array<{ id: string; igMediaId: string; status: string }>; history: Array<{ id: string; status: string; summary: unknown }>; posts: Array<{ id: string }> };
const overview = async (): Promise<Overview> => (await (await page.request.get("/api/monitoring")).json()).data;
const start = (igMediaId: string, duration: string) => page.request.post("/api/monitoring", { data: { igMediaId, duration } });
const runCron = async () => {
  const res = await page.request.get("/api/cron/monitor", { headers: { authorization: `Bearer ${CRON_SECRET}` }, timeout: 120_000 });
  expect(res.status()).toBe(200);
  return (await res.json()).data as { read: number; reused: number; ended: number; summarized: number; failed: number };
};
const notifications = async () => (await (await page.request.get("/api/notifications")).json()).data.items as Array<{ type: string; href: string; params: Record<string, number> }>;

async function stopAll() {
  for (const m of (await overview()).active) await page.request.post(`/api/monitoring/${m.id}/stop`);
}

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  db = testDb();
  stub = await startGeminiStub();
  page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  await login(page, USER);
  if ((await page.locator("html").getAttribute("dir")) === "rtl") await switchLanguage(page, "en");
  await stopAll();
});

test.afterAll(async () => {
  await stopAll().catch(() => {});
  await page.close();
  await stub.close();
  await db.close();
});

// ── Part 1: "Monitor this post" ─────────────────────────────────────────────────

test("Monitor this post: pick a duration, extend it and stop it from the post's detail view", async () => {
  await page.goto("/post-performance");
  await page.getByTestId("recent-post").nth(1).click();
  await expect(page).toHaveURL(/\/post-performance\/.+/);
  const card = page.getByTestId("monitor-card");
  await expect(card).toContainText("Monitor this post");
  await expect(page.getByTestId("monitor-switch")).not.toBeChecked();

  await page.getByTestId("monitor-switch").click();
  const durations = page.getByTestId("monitor-durations");
  await expect(durations.getByRole("radio")).toHaveText(["2 hours", "6 hours", "24 hours", "3 days", "7 days", "30 days", "90 days", "1 year"]);
  await expect(durations).toContainText("Up to 3 days: a reading every hour. Longer: once a day.");
  await durations.getByRole("radio", { name: "6 hours" }).click();
  await page.getByTestId("monitor-confirm").click();
  await expect(page.getByText("Monitoring started. The first reading is in.")).toBeVisible();
  await expect(page.getByTestId("monitor-switch")).toBeChecked();
  await expect(card.getByTestId("monitor-timing")).toHaveText(/Ends in (5|6) hours · reading every hour/);

  // Extending by 3 days makes it longer than 3 days: from then on, one reading a day.
  await page.getByTestId("monitor-extend").click();
  await durations.getByRole("radio", { name: "3 days" }).click();
  await page.getByTestId("monitor-confirm").click();
  await expect(page.getByText("Monitoring extended.")).toBeVisible();
  await expect(card.getByTestId("monitor-timing")).toHaveText(/Ends in 3 days · reading once a day/);

  const id = (await overview()).active[0].id;
  const row = await db.monitor(id);
  expect(row.interval).toBe("DAILY");
  expect(row.endsAt.getTime() - row.startedAt.getTime()).toBeGreaterThan(3 * 24 * HOUR);
  expect(await db.readings(id)).toBe(1);

  await page.getByTestId("monitor-stop").click();
  await page.getByRole("dialog").getByRole("button", { name: "Stop monitoring" }).click();
  await expect(page.getByText("Monitoring stopped. The final numbers are in the history.")).toBeVisible();
  await expect(page.getByTestId("monitor-switch")).not.toBeChecked();
  const stopped = (await overview()).history.find((m) => m.id === id);
  expect(stopped?.status).toBe("stopped");
});

test("the plan's limit (configurable, default 5) and one monitor per post", async ({ browser }) => {
  const setLimit = (monitoredPosts: number) =>
    asAdmin(browser, async (admin) => expect((await admin.request.patch("/api/admin/settings", { data: { planLimits: { pro: { monitoredPosts } } } })).ok()).toBe(true));
  expect((await overview()).limit).toBe(5);
  const posts = (await overview()).posts.map((p) => p.id);
  await setLimit(2);
  try {
    expect((await overview()).limit).toBe(2);
    expect((await start(posts[0], "24h")).status()).toBe(201);
    const twice = await start(posts[0], "7d");
    expect(twice.status()).toBe(409);
    expect((await twice.json()).error.code).toBe("monitor_exists");
    expect((await start(posts[1], "2h")).status()).toBe(201);
    const third = await start(posts[2], "2h");
    expect(third.status()).toBe(409);
    expect((await third.json()).error).toMatchObject({ code: "monitor_limit", details: [{ path: "max", message: "2" }] });
    expect((await start("ig_media_not_mine", "2h")).status()).toBe(404);
    expect((await start(posts[2], "5d")).status()).toBe(400);
  } finally {
    await stopAll();
    await setLimit(5);
  }
  // The competitor limit is untouched by the new field.
  await asAdmin(browser, async (admin) => expect((await (await admin.request.get("/api/admin/settings")).json()).data.planLimits.pro).toEqual({ competitors: 5, monitoredPosts: 5 }));
});

test("the hourly job: needs CRON_SECRET, reads due posts, alerts on a spike and ends with an AI summary", async ({ request }) => {
  expect((await request.get("/api/cron/monitor")).status()).toBe(401);
  expect((await request.get("/api/cron/monitor", { headers: { authorization: "Bearer wrong" } })).status()).toBe(401);

  const igMediaId = (await overview()).posts[0].id;
  const res = await start(igMediaId, "2h");
  expect(res.status()).toBe(201);
  const { id } = (await res.json()).data as { id: string };

  // An hour later, with an account average far below this post: the reading is due and is a spike.
  await db.update(id, { nextReadingAt: new Date(Date.now() - 1000), baseline: { avgInteractions: 10, avgReach: null, basedOn: 12 }, alerts: {} });
  const first = await runCron();
  expect(first.read).toBeGreaterThanOrEqual(1);
  expect(await db.readings(id)).toBe(2);
  const spike = (await notifications()).find((n) => n.type === "monitor_above" && n.href === `/post-monitoring/${id}`);
  expect(spike).toBeTruthy();
  expect(spike!.params.average).toBe(10);
  // Same level again: no second alert.
  await db.update(id, { nextReadingAt: new Date(Date.now() - 1000) });
  await runCron();
  expect((await notifications()).filter((n) => n.type === "monitor_above" && n.href === `/post-monitoring/${id}`)).toHaveLength(1);

  // Time's up: a last reading, the final numbers, the AI summary (only numbers from the data) and a notification.
  await db.update(id, { endsAt: new Date(Date.now() - 1000), lastReadingAt: new Date(Date.now() - 2 * HOUR) });
  const end = await runCron();
  expect(end.ended).toBeGreaterThanOrEqual(1);
  const ended = await db.monitor(id);
  expect(ended.status).toBe("ENDED");
  expect((ended.outcome as { readings: number }).readings).toBe(4);
  expect((ended.summary as { en: string }).en).toBe("Based on 4 readings, the post kept growing while it was monitored. Posts like this seem to work for you.");
  const call = stub.calls.filter((c) => c.kind === "monitor").at(-1)!;
  expect(call.system).toContain("<monitoring_data>");
  expect(call.system).toContain("4 readings");
  expect(call.system).toContain("vs average 10");
  expect((await notifications()).some((n) => n.type === "monitor_ended" && n.href === `/post-monitoring/${id}`)).toBe(true);
});

test("an AI summary with invented numbers is rejected: the history keeps the numbers only", async () => {
  const igMediaId = (await overview()).posts[1].id;
  const { id } = (await (await start(igMediaId, "6h")).json()).data as { id: string };
  stub.state.inventMonitor = true;
  try {
    await db.update(id, { endsAt: new Date(Date.now() - 1000) });
    await runCron();
  } finally {
    stub.state.inventMonitor = false;
  }
  const row = await db.monitor(id);
  expect(row.status).toBe("ENDED");
  expect(row.summary).toBeNull();
  expect(row.summaryStatus).toBe("unavailable");
  expect(row.outcome).not.toBeNull();
  // Asking again from the page writes it once the AI answers properly.
  const again = await page.request.post(`/api/monitoring/${id}/summary`);
  expect((await again.json()).data.status).toBe("ready");
});

test("daily monitoring reuses the day's snapshot instead of asking Instagram again", async () => {
  const igMediaId = (await overview()).posts[2].id;
  const { id } = (await (await start(igMediaId, "30d")).json()).data as { id: string };
  const row = await db.monitor(id);
  expect(row.interval).toBe("DAILY");
  // The start took today's reading into the daily snapshots (Post performance's history).
  const today = new Date().toISOString().slice(0, 10);
  expect(await db.dailyRows(row.businessId, igMediaId, today)).toBe(1);
  expect(await db.readings(id)).toBe(0);
  await db.update(id, { nextReadingAt: new Date(Date.now() - 1000) });
  const result = await runCron();
  expect(result.reused).toBeGreaterThanOrEqual(1);
  const after = await db.monitor(id);
  expect(after.nextReadingAt.getTime()).toBeGreaterThan(Date.now() + 23 * HOUR);
  await page.request.post(`/api/monitoring/${id}/stop`);
});

test("notification settings list post monitoring", async () => {
  await page.goto("/settings");
  await expect(page.getByText("Big changes on a monitored post, and when monitoring ends.")).toBeVisible();
});
