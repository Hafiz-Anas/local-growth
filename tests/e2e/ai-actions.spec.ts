import path from "node:path";
import { Pool } from "pg";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { startGeminiStub } from "./gemini-stub";

/**
 * AI actions from the chat (AI4), for the demo business "Mathanet Baity" (mock Instagram) with the Gemini stub
 * (tests/e2e/gemini-stub.ts → stubChatAction): "Schedule this for Friday at 8pm" proposes a schedule on the newest
 * post card (saved as a draft first) in the business's time zone, and nothing happens until Approve; Approve
 * schedules it for real (ScheduledPost at 17:00 UTC = 20:00 Kuwait) and the step says so. "Make the caption shorter
 * and save it" saves straight away and updates the post card. A day without a time gets a question back; Cancel on a
 * card does nothing; "Cancel tomorrow's post" cancels after Approve; "Post it now" follows the post until it's on
 * Instagram; an expired proposal can't be approved; every action is an AiChatAction row with the chat message, draft,
 * job and result. With the AI down the chat says so (the card's buttons still work); with publishing switched off
 * the AI isn't offered the Instagram actions; admin preview shows the cards read-only. Arabic on a phone, dark mode.
 * Screenshots go to E2E_SHOTS_DIR (default test-results/ai-actions-shots).
 */

const USER = { email: "user@mathanetbaity.dev", password: "User@123" };
const ADMIN = { email: "admin@localgrowth.dev", password: "Admin@123" };
const SHOTS = process.env.E2E_SHOTS_DIR ?? "test-results/ai-actions-shots";
const TZ = "Asia/Kuwait";

test.describe.configure({ mode: "serial", timeout: 150_000 });

let pool: Pool;
let stub: Awaited<ReturnType<typeof startGeminiStub>>;
let page: Page;
let businessId: string;

async function login(p: Page, account = USER) {
  await p.goto("/login");
  await p.getByLabel("Email").fill(account.email);
  await p.getByLabel("Password", { exact: true }).fill(account.password);
  await p.getByRole("button", { name: "Log in" }).click();
  await p.waitForURL((url) => !url.pathname.startsWith("/login"));
}

const composer = (p = page) => p.getByRole("textbox", { name: /Ask anything…|اسأل/ });
async function ask(question: string, p = page) {
  await composer(p).fill(question);
  await composer(p).press("Enter");
}
const cards = (p = page) => p.getByTestId("action-card");
const lastCard = (p = page) => cards(p).last();

/** Today in Kuwait, and the next given weekday after it (as the stub works it out). */
function kuwaitDay(offset = 0) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  return new Date(Date.parse(`${today}T12:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
}
function nextWeekday(weekday: number) {
  const now = new Date(`${kuwaitDay()}T12:00:00Z`).getUTCDay();
  return kuwaitDay(((weekday - now + 7) % 7) || 7);
}

/** Opens the AI tab and waits for the Gallery (its photos are what post cards are made from). */
async function openAi(p = page) {
  // The business's own Gallery, or the read-only copy in admin preview.
  const loaded = p.waitForResponse((r) => /^\/api\/(admin\/preview\/[^/]+\/)?gallery$/.test(new URL(r.url()).pathname) && r.ok());
  await p.goto("/ai");
  await loaded;
}

/** Opens the AI tab again on the newest chat (after a reload). */
async function reopenChat(p = page) {
  await openAi(p);
  await p.getByTestId("chat-item").first().getByRole("button").first().click();
}

/** A post card for the demo's next photo (a sample answer: no AI call). */
async function newPostCard(p = page) {
  const before = await p.getByTestId("post-caption").count();
  await ask("What should I post tomorrow?", p);
  try {
    await expect(p.getByTestId("post-caption")).toHaveCount(before + 1, { timeout: 20_000 });
  } catch (error) {
    await p.screenshot({ path: path.join(SHOTS, `debug-post-card-${Date.now()}.png`), fullPage: true });
    throw error;
  }
}

const actionRows = async () =>
  (await pool.query<{ type: string; status: string; draftId: string | null; scheduledPostId: string | null; messageClientId: string; errorCode: string | null }>(
    `SELECT type::text, status::text, "draftId", "scheduledPostId", "messageClientId", "errorCode" FROM "AiChatAction" WHERE "businessId" = $1 ORDER BY "createdAt"`,
    [businessId],
  )).rows;

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) throw new Error("Set DATABASE_URL to the local e2e database.");
  pool = new Pool({ connectionString: url.replace(/\?.*$/, "") });
  stub = await startGeminiStub();
  businessId = (await pool.query(`SELECT "businessId" FROM "User" WHERE email = $1`, [USER.email])).rows[0].businessId;
  await pool.query(`UPDATE "User" SET "uiPreferences" = jsonb_set(COALESCE("uiPreferences", '{}'::jsonb), '{language}', '"en"') WHERE email = $1`, [USER.email]);
  // A clean slate: no chats (the sample chats stay claimed), no upcoming posts of earlier runs.
  await pool.query(`DELETE FROM "AssistantConversation" WHERE "businessId" = $1`, [businessId]);
  await pool.query(`UPDATE "Business" SET "aiChatsSeededAt" = now() WHERE id = $1`, [businessId]);
  await pool.query(`UPDATE "ScheduledPost" SET status = 'CANCELLED' WHERE "businessId" = $1 AND status IN ('SCHEDULED', 'FAILED')`, [businessId]);
  page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  await login(page);
  // next dev answers the first request to a route it hasn't compiled with an HTML 404.
  for (const route of ["/ai", "/api/ai-chats", "/api/gallery"]) await page.request.get(route);
  await page.request.post("/api/ai-chat/actions/none/approve");
  await page.request.post("/api/ai-chats/none/messages", { data: { messages: [] } });
  await page.request.patch("/api/ai-chats/none/messages/none", { data: {} });
  await page.request.post("/api/ai-chat/actions/none/dismiss");
});

test.afterAll(async () => {
  await page.close();
  await stub.close();
  await pool.end();
});

test("\"Schedule this for Friday at 8pm\": a confirmation card, nothing happens until Approve, then it's scheduled for real", async () => {
  await openAi();
  await newPostCard();
  const jobsBefore = Number((await pool.query(`SELECT count(*) FROM "ScheduledPost" WHERE "businessId" = $1 AND status = 'SCHEDULED'`, [businessId])).rows[0].count);

  await ask("Schedule this for Friday at 8pm");
  // Real progress while the AI works, not timed steps.
  await expect(page.getByTestId("ai-typing")).toContainText("Reading your question…");
  const card = lastCard();
  await expect(card).toHaveAttribute("data-status", "proposed", { timeout: 30_000 });
  await expect(card).toHaveAttribute("data-type", "schedule");
  await expect(card).toContainText("Schedule this post");
  await expect(card.getByTestId("action-when")).toContainText("8:00 PM (Kuwait time)");
  await expect(card.getByTestId("action-when")).toContainText("Fri");
  await expect(card.getByTestId("action-step").filter({ hasText: "Draft saved" })).toBeVisible();
  await expect(page.getByText("Here's what I'll do. Nothing happens until you tap Approve.")).toBeVisible();
  // The AI saw the post as a ref, today's date and only the switched-on tools.
  const call = stub.calls.filter((c) => c.kind === "chat").at(-1)!;
  expect(call.system).toMatch(/- P1: post card in this chat \(the newest one\), not saved yet/);
  expect(call.system).toMatch(/Today is \w+ \d{4}-\d{2}-\d{2}, \d{2}:\d{2} \(Asia\/Kuwait time\)/);
  expect(call.system).toContain("schedule — schedule a post");

  // Proposed only: no job yet; the action is recorded with its chat message and draft.
  expect(Number((await pool.query(`SELECT count(*) FROM "ScheduledPost" WHERE "businessId" = $1 AND status = 'SCHEDULED'`, [businessId])).rows[0].count)).toBe(jobsBefore);
  let [row] = (await actionRows()).slice(-1);
  expect(row).toMatchObject({ type: "SCHEDULE", status: "PROPOSED" });
  expect(row.draftId).toBeTruthy();
  await page.screenshot({ path: path.join(SHOTS, "desktop-confirmation.png") });

  await card.getByTestId("action-approve").click();
  await expect(card).toHaveAttribute("data-status", "done", { timeout: 60_000 });
  await expect(card.getByTestId("action-step").filter({ hasText: /^Scheduled for Fri/ })).toBeVisible();
  await expect(card.getByTestId("action-approve")).toHaveCount(0);
  [row] = (await actionRows()).slice(-1);
  expect(row).toMatchObject({ type: "SCHEDULE", status: "DONE" });
  // Read as text: the pg driver would read the stored UTC time as local time.
  const job = (await pool.query(`SELECT to_char("scheduledFor", 'YYYY-MM-DD"T"HH24:MI') AS at, status::text, "draftId" FROM "ScheduledPost" WHERE id = $1`, [row.scheduledPostId])).rows[0];
  expect(job.status).toBe("SCHEDULED");
  expect(job.draftId).toBe(row.draftId);
  // 20:00 in Kuwait (UTC+3) on the next Friday.
  expect(job.at).toBe(`${nextWeekday(5)}T17:00`);
  // The post card shows it's scheduled too.
  await expect(page.getByTestId("card-publish-status").last()).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: path.join(SHOTS, "desktop-scheduled.png") });
  // The action card stays as it was after a reload (saved by the server).
  await reopenChat();
  await expect(lastCard()).toHaveAttribute("data-status", "done");
});

test("\"Make the caption shorter and save it\": saved straight away, the post card shows the new caption", async () => {
  await ask("Make the caption shorter and save it");
  const card = lastCard();
  await expect(card).toHaveAttribute("data-type", "save_draft", { timeout: 30_000 });
  await expect(card).toHaveAttribute("data-status", "done");
  await expect(card.getByTestId("action-caption")).toContainText("Short stub caption.");
  await expect(page.getByText("Done. I saved it as a draft.")).toBeVisible();
  await expect(page.getByTestId("post-caption").last()).toContainText("Short stub caption.");
  const [row] = (await actionRows()).slice(-1);
  expect(row).toMatchObject({ type: "SAVE_DRAFT", status: "DONE" });
  const draft = (await pool.query(`SELECT "captionEn", "captionAr" FROM "PostDraft" WHERE id = $1`, [row.draftId])).rows[0];
  expect(draft.captionEn).toMatch(/^Short stub caption\./);
  expect(draft.captionAr).toMatch(/^كابشن قصير تجريبي\./);
});

test("unsure about the time: it asks instead of guessing; 'Not now' on a proposal does nothing", async () => {
  const before = (await actionRows()).length;
  await ask("Schedule this for Friday");
  await expect(page.getByText("When should it go out? Tell me the day and the time")).toBeVisible({ timeout: 30_000 });
  expect((await actionRows()).length).toBe(before);

  const job = (await pool.query(`SELECT id, "scheduledFor" FROM "ScheduledPost" WHERE "businessId" = $1 AND status = 'SCHEDULED' ORDER BY "approvedAt" DESC NULLS LAST LIMIT 1`, [businessId])).rows[0];
  await ask("Move it to Saturday at 9am");
  const card = lastCard();
  await expect(card).toHaveAttribute("data-type", "reschedule", { timeout: 30_000 });
  await expect(card.getByTestId("action-when")).toContainText("9:00 AM (Kuwait time)");
  await expect(card).toContainText("Was Fri");
  await card.getByTestId("action-dismiss").click();
  await expect(card).toHaveAttribute("data-status", "cancelled");
  await expect(card.getByTestId("action-step").filter({ hasText: "Not done" })).toBeVisible();
  const after = (await pool.query(`SELECT "scheduledFor", status::text FROM "ScheduledPost" WHERE id = $1`, [job.id])).rows[0];
  expect(after.status).toBe("SCHEDULED");
  expect(new Date(after.scheduledFor).getTime()).toBe(new Date(job.scheduledFor).getTime());
  expect((await actionRows()).at(-1)).toMatchObject({ type: "RESCHEDULE", status: "CANCELLED" });
});

test("\"Cancel tomorrow's post\": cancelled after Approve, back in the drafts", async () => {
  // The post scheduled above, moved to tomorrow 20:00 Kuwait time.
  const job = (await pool.query(`SELECT id, "draftId" FROM "ScheduledPost" WHERE "businessId" = $1 AND status = 'SCHEDULED' ORDER BY "approvedAt" DESC NULLS LAST LIMIT 1`, [businessId])).rows[0];
  await pool.query(`UPDATE "ScheduledPost" SET "scheduledFor" = $2 WHERE id = $1`, [job.id, `${kuwaitDay(1)}T17:00:00.000Z`]);
  await ask("Cancel tomorrow's post");
  const card = lastCard();
  await expect(card).toHaveAttribute("data-type", "cancel", { timeout: 30_000 });
  await expect(card).toContainText("It won't be posted. It goes back to your drafts.");
  await page.screenshot({ path: path.join(SHOTS, "desktop-cancel-proposed.png") });
  await card.getByTestId("action-approve").click();
  await expect(card).toHaveAttribute("data-status", "done", { timeout: 30_000 });
  await expect(card.getByTestId("action-step").filter({ hasText: "Cancelled. It's back in your drafts." })).toBeVisible();
  expect((await pool.query(`SELECT status::text FROM "ScheduledPost" WHERE id = $1`, [job.id])).rows[0].status).toBe("CANCELLED");
  expect((await pool.query(`SELECT status::text FROM "PostDraft" WHERE id = $1`, [job.draftId])).rows[0].status).toBe("DRAFT");
  expect((await actionRows()).at(-1)).toMatchObject({ type: "CANCEL", status: "DONE", scheduledPostId: job.id });
});

test("\"Post it now\": the steps follow the post until it's on Instagram", async () => {
  await newPostCard();
  await ask("Post it now");
  const card = lastCard();
  await expect(card).toHaveAttribute("data-type", "post_now", { timeout: 30_000 });
  await expect(card).toContainText("It goes live on Instagram as soon as you approve.");
  await card.getByTestId("action-approve").click();
  await expect(card).toHaveAttribute("data-status", "done", { timeout: 60_000 });
  await expect(card.getByTestId("action-step").filter({ hasText: "Sent to Instagram" })).toBeVisible();
  await expect(card.locator('[data-step="posted"]')).toContainText("Posted on Instagram", { timeout: 60_000 });
  await page.screenshot({ path: path.join(SHOTS, "desktop-posted.png") });
  expect((await actionRows()).at(-1)).toMatchObject({ type: "POST_NOW", status: "DONE" });
});

test("an expired proposal can't be approved", async () => {
  await newPostCard();
  await ask("Schedule this for Friday at 8pm");
  const card = lastCard();
  await expect(card).toHaveAttribute("data-status", "proposed", { timeout: 30_000 });
  await pool.query(`UPDATE "AiChatAction" SET "expiresAt" = (now() AT TIME ZONE 'UTC') - interval '1 minute' WHERE "businessId" = $1 AND status = 'PROPOSED'`, [businessId]);
  await card.getByTestId("action-approve").click();
  await expect(card).toHaveAttribute("data-status", "expired");
  await expect(card).toContainText("More than 30 minutes have passed. Ask me again.");
  expect((await actionRows()).at(-1)).toMatchObject({ type: "SCHEDULE", status: "EXPIRED", errorCode: "action_expired" });
});

test("with the AI down the chat says so and points to the card's buttons", async () => {
  stub.state.fail = true;
  try {
    await ask("Schedule this for Friday at 8pm");
    await expect(page.getByText("I can't do that right now. Use the buttons on the post card instead")).toBeVisible({ timeout: 30_000 });
  } finally {
    stub.state.fail = false;
  }
});

test("with publishing switched off, the AI isn't offered the Instagram actions; admin preview is read-only", async ({ browser }) => {
  const admin = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  await login(admin, ADMIN);
  const set = (value: boolean) => admin.request.patch(`/api/admin/businesses/${businessId}/permissions`, { data: { changes: { "gallery.publishing": value } } });
  try {
    // A proposal made while publishing was on is checked again on Approve.
    await ask("Schedule this for Friday at 8pm");
    const proposal = lastCard();
    await expect(proposal).toHaveAttribute("data-status", "proposed", { timeout: 30_000 });
    expect((await set(false)).ok()).toBe(true);
    await proposal.getByTestId("action-approve").click();
    await expect(proposal).toHaveAttribute("data-status", "failed");
    await expect(proposal).toContainText("Publishing is switched off for this account.");
    expect((await actionRows()).at(-1)).toMatchObject({ status: "FAILED", errorCode: "feature_disabled" });

    // New questions: the AI isn't offered the Instagram actions, so there's no card.
    await openAi();
    const before = await cards().count();
    await ask("Schedule this for Friday at 8pm");
    await expect(page.getByTestId("ai-typing")).toHaveCount(0, { timeout: 30_000 });
    await expect(cards()).toHaveCount(before);
    const call = stub.calls.filter((c) => c.kind === "chat").at(-1)!;
    expect(call.system).toContain("save_draft — ");
    expect(call.system).not.toContain("schedule — schedule a post");
  } finally {
    expect((await set(true)).ok()).toBe(true);
  }
  // Admin preview: the cards are there, read-only — a proposal waiting for the owner can't be approved by the admin.
  await openAi();
  await page.getByTestId("chat-item").filter({ hasText: "What should I post tomorrow?" }).getByRole("button").first().click();
  await ask("Schedule this for Friday at 8pm");
  await expect(lastCard()).toHaveAttribute("data-status", "proposed", { timeout: 30_000 });
  await admin.goto(`/admin/clients/${businessId}`);
  await admin.getByRole("button", { name: /Preview as this client/ }).click();
  await admin.waitForURL((u) => !u.pathname.startsWith("/admin"));
  // next dev answers the first request to a route it hasn't compiled with an HTML 404.
  await admin.request.get(`/api/admin/preview/${businessId}/ai-chats/none`);
  await openAi(admin);
  await admin.getByTestId("chat-item").filter({ hasText: "What should I post tomorrow?" }).getByRole("button").first().click();
  const waiting = admin.getByTestId("action-card").last();
  await expect(waiting).toHaveAttribute("data-status", "proposed");
  await expect(waiting).toContainText("Approving is off in preview.");
  await expect(admin.getByTestId("action-approve")).toHaveCount(0);
  await admin.close();
});

test("Arabic on a phone, and dark mode", async ({ browser }) => {
  // A new login, a post card, an approval (photos prepared for Instagram) and a reload: longer than the others.
  test.setTimeout(300_000);
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  try {
    await login(phone);
    await pool.query(`UPDATE "User" SET "uiPreferences" = jsonb_set(COALESCE("uiPreferences", '{}'::jsonb), '{language}', '"ar"') WHERE email = $1`, [USER.email]);
    await phone.context().addCookies([{ name: "lge_locale", value: "ar", url: "http://localhost:3001" }]);
    await openAi(phone);
    await expect(phone.locator("html")).toHaveAttribute("dir", "rtl");
    await newPostCard(phone);
    await ask("جدول هذا الجمعة 8 مساءً", phone);
    const card = lastCard(phone);
    await expect(card).toHaveAttribute("data-status", "proposed", { timeout: 30_000 });
    await expect(card).toContainText("جدولة هذا المنشور");
    await expect(card.getByTestId("action-when")).toContainText("بتوقيت الكويت");
    await expect(card.getByTestId("action-approve")).toHaveText("موافقة");
    expect(await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await card.scrollIntoViewIfNeeded();
    await phone.screenshot({ path: path.join(SHOTS, "phone-arabic-confirmation.png") });
    await card.getByTestId("action-approve").click();
    await expect(card).toHaveAttribute("data-status", "done", { timeout: 60_000 });
    await expect(card.getByTestId("action-step").filter({ hasText: /^مجدول في/ })).toBeVisible();
    await phone.screenshot({ path: path.join(SHOTS, "phone-arabic-scheduled.png") });
    // Dark mode (saved in the account too, or the saved light theme comes back after the page loads).
    await pool.query(`UPDATE "User" SET "uiPreferences" = jsonb_set(COALESCE("uiPreferences", '{}'::jsonb), '{theme}', '"dark"') WHERE email = $1`, [USER.email]);
    await phone.context().addCookies([{ name: "lge_theme", value: "dark", url: "http://localhost:3001" }]);
    await phone.reload({ waitUntil: "networkidle" });
    await expect(phone.locator("html")).toHaveClass(/dark/);
    // On a phone the chat list is a drawer: open it from the header button, then the chat.
    const item = phone.getByTestId("chat-item").first();
    if (!(await item.isVisible())) await phone.getByRole("button", { name: /المحادثات|Chats/ }).first().click();
    await item.getByRole("button").first().click();
    await expect(lastCard(phone)).toBeVisible();
    await lastCard(phone).scrollIntoViewIfNeeded();
    await expect(phone.locator("html")).toHaveClass(/dark/);
    await phone.screenshot({ path: path.join(SHOTS, "phone-arabic-dark.png") });
  } finally {
    await pool.query(`UPDATE "User" SET "uiPreferences" = COALESCE("uiPreferences", '{}'::jsonb) || '{"language": "en", "theme": "light"}'::jsonb WHERE email = $1`, [USER.email]);
    await phone.close();
  }
});
