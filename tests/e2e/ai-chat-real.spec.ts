import path from "node:path";
import { Pool } from "pg";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { startGeminiStub } from "./gemini-stub";

/**
 * The AI tab with a real business's data (AI3, AI2, BE5): the seeded "Noor Boutique" is made a real business for
 * this spec (its Instagram connection set to a connected META one, put back afterwards) with five synced posts. Its
 * questions go to the AI (Gemini stub) with the business facts — onboarding answers, brand voice, the posts'
 * numbers — and the chat's earlier turns, so a follow-up works; an answer quoting an invented number loses that
 * sentence, one that's mostly invented isn't shown (an honest "can't answer from your data yet" instead); chats
 * are saved on the server: they open in a fresh browser, a browser's old local chats are imported once (sample
 * chats never, for a real business), rename and delete stick; another business's chat is 404 on every route,
 * the routes are 404 with the AI chat switched off, and admin preview is read-only. Screenshots go to
 * E2E_SCREENSHOTS when it's set.
 */

const BOUTIQUE = { email: "boutique@localgrowth.dev", password: "User@123" };
const CAFE = { email: "cafe@localgrowth.dev", password: "User@123" };
const ADMIN = { email: "admin@localgrowth.dev", password: "Admin@123" };
const CAFE_CHAT = "e2e-cafe-chat";
const FIRST = "How are my posts doing?";
const FOLLOW_UP = "And which day was best?";

test.describe.configure({ mode: "serial", timeout: 120_000 });

let pool: Pool;
let stub: Awaited<ReturnType<typeof startGeminiStub>>;
let page: Page;
let businessId: string;
let cafeId: string;
let original: { provider: string; status: string; tokenExpiresAt: Date | null };

async function login(p: Page, account: { email: string; password: string }) {
  await p.goto("/login");
  await p.getByLabel("Email").fill(account.email);
  await p.getByLabel("Password", { exact: true }).fill(account.password);
  await p.getByRole("button", { name: "Log in" }).click();
  await p.waitForURL((url) => !url.pathname.startsWith("/login"));
}

const composer = (p = page, name = "Ask anything…") => p.getByRole("textbox", { name });
const chatItem = (title: string | RegExp, p = page) => p.getByTestId("chat-item").filter({ hasText: title });
const toast = (text: string | RegExp) => page.locator("[data-sonner-toast]").filter({ hasText: text });
const chatCalls = () => stub.calls.filter((c) => c.kind === "chat");
const businessOf = async (email: string) => (await pool.query<{ businessId: string }>(`SELECT "businessId" FROM "User" WHERE email = $1`, [email])).rows[0].businessId;
const shot = async (p: Page, name: string) => {
  if (process.env.E2E_SCREENSHOTS) await p.screenshot({ path: path.join(process.env.E2E_SCREENSHOTS, `${name}.png`) });
};
async function ask(question: string, p = page, label?: string) {
  await composer(p, label).fill(question);
  await composer(p, label).press("Enter");
}
/** A signed-in browser of its own (a "fresh device": no localStorage, no cookies). */
async function freshDevice(browser: Browser, account = BOUTIQUE, options: Parameters<Browser["newContext"]>[0] = {}): Promise<{ context: BrowserContext; p: Page }> {
  const context = await browser.newContext({ viewport: { width: 1366, height: 860 }, ...options });
  const p = await context.newPage();
  await login(p, account);
  return { context, p };
}

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) throw new Error("Set DATABASE_URL to the local e2e database.");
  pool = new Pool({ connectionString: url.replace(/\?.*$/, "") });
  businessId = await businessOf(BOUTIQUE.email);
  cafeId = await businessOf(CAFE.email);
  original = (await pool.query<typeof original>(`SELECT provider, status, "tokenExpiresAt" FROM "InstagramConnection" WHERE "businessId" = $1`, [businessId])).rows[0];
  // English to start with (a run stopped during the Arabic test would leave it saved).
  await pool.query(`UPDATE "User" SET "uiPreferences" = jsonb_set(COALESCE("uiPreferences", '{}'::jsonb), '{language}', '"en"') WHERE email = $1`, [BOUTIQUE.email]);
  await pool.query(`DELETE FROM "AssistantConversation" WHERE "businessId" = $1`, [businessId]);
  await pool.query(`DELETE FROM "InstagramMedia" WHERE "businessId" = $1`, [businessId]);
  await pool.query(`UPDATE "InstagramConnection" SET provider = 'META', status = 'CONNECTED', "tokenExpiresAt" = now() + interval '30 days' WHERE "businessId" = $1`, [businessId]);
  // Five synced posts: 100…180 likes, so the facts say "Averages per post: 140 likes".
  for (let i = 0; i < 5; i++) {
    await pool.query(
      `INSERT INTO "InstagramMedia" (id, "businessId", "igMediaId", caption, "mediaType", "mediaProductType", "mediaUrl", permalink, "postedAt", "likeCount", "commentsCount", insights)
       VALUES ($1, $2, $3, $4, $5, 'FEED', '/photos/tannour/05.jpg', $6, now() - ($7 || ' days')::interval, $8, 10, $9)`,
      [`e2e-chat-media-${i}`, businessId, `e2e-chat-ig-${i}`, `New abaya collection, look ${"ABCDE"[i]}`, i % 2 ? "IMAGE" : "VIDEO", `https://www.instagram.com/p/e2echat${i}/`, String(2 + i * 2), 100 + i * 20, JSON.stringify({ reach: 1000 + i * 200, saved: 5, shares: 2 })],
    );
  }
  // Dalla & Bean's own chat (to try another business's chat id).
  await pool.query(`DELETE FROM "AssistantConversation" WHERE "businessId" = $1 AND "clientKey" = $2`, [cafeId, CAFE_CHAT]);
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO "AssistantConversation" (id, "businessId", title, "clientKey", "updatedAt") VALUES ('e2e-cafe-conv', $1, 'Theirs', $2, now()) RETURNING id`,
    [cafeId, CAFE_CHAT],
  );
  await pool.query(
    `INSERT INTO "AssistantMessage" (id, "conversationId", role, content, language, payload, "clientId") VALUES ('e2e-cafe-msg', $1, 'USER', 'Their secret question', 'en', $2, 'm1')`,
    [rows[0].id, JSON.stringify({ id: "m1", role: "user", text: { en: "Their secret question", ar: "Their secret question" } })],
  );
  stub = await startGeminiStub();
  page = await browser.newPage({ viewport: { width: 1366, height: 860 } });
  // next dev answers the first request to a dynamic route it hasn't compiled yet with an HTML 404: compile them first.
  for (const route of [`/api/ai-chats/x`, `/api/ai-chats/x/messages`, `/api/ai-chats/x/messages/y`, `/api/admin/preview/${businessId}/gallery`, `/api/admin/preview/${businessId}/ai-chats`, `/api/admin/preview/${businessId}/ai-chats/x`])
    await page.request.get(route);
  await login(page, BOUTIQUE);
});

test.afterAll(async () => {
  await page?.close();
  await stub?.close();
  if (pool) {
    await pool.query(`UPDATE "InstagramConnection" SET provider = $2, status = $3, "tokenExpiresAt" = $4 WHERE "businessId" = $1`, [businessId, original.provider, original.status, original.tokenExpiresAt]);
    await pool.query(`DELETE FROM "InstagramMedia" WHERE "businessId" = $1`, [businessId]);
    await pool.query(`DELETE FROM "AssistantConversation" WHERE "businessId" = $1`, [businessId]);
    await pool.query(`DELETE FROM "AssistantConversation" WHERE id = 'e2e-cafe-conv'`);
    await pool.query(`DELETE FROM "FeaturePermission" WHERE "businessId" = $1 AND "featureKey" = 'aiChat'`, [businessId]);
    await pool.end();
  }
});

test("a real business's question is answered from its own facts, with no sample answer", async () => {
  await page.goto("/ai");
  // A real business gets no sample chats.
  await expect(page.getByRole("heading", { name: "What would you like to do?" })).toBeVisible();
  await expect(page.getByTestId("chat-item")).toHaveCount(0);
  await ask(FIRST);
  const answer = page.getByText(`Stub answer to: ${FIRST} Your posts average 140 likes.`);
  await expect(answer).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("sample-answer")).toHaveCount(0);

  const call = chatCalls().at(-1)!;
  // The business facts: onboarding answers, brand voice and the real posts' numbers, with dates and sample sizes.
  expect(call.system).toContain("<business_facts>");
  expect(call.system).toContain("Name: Noor Boutique");
  expect(call.system).toMatch(/## Brand profile/);
  expect(call.system).toContain("## Recent posts (5, newest first)");
  expect(call.system).toContain("Averages per post: 140 likes, 10 comments, reach 1400");
  expect(call.system).toMatch(/Every number you state/);
  expect(call.system).not.toContain("demo account");
  // A new chat: no history yet, just the question.
  expect(call.turns).toEqual([{ role: "user", text: FIRST }]);
  // Saved: the question and the answer are in the database.
  const stored = await pool.query<{ role: string; content: string }>(
    `SELECT m.role, m.content FROM "AssistantMessage" m JOIN "AssistantConversation" c ON c.id = m."conversationId" WHERE c."businessId" = $1 ORDER BY m."createdAt"`,
    [businessId],
  );
  expect(stored.rows).toEqual([
    { role: "USER", content: FIRST },
    { role: "ASSISTANT", content: `Stub answer to: ${FIRST} Your posts average 140 likes.` },
  ]);
  await shot(page, "1-real-answer");
});

test("a follow-up question gets the chat's earlier turns", async () => {
  await ask(FOLLOW_UP);
  await expect(page.getByText(`Stub answer to: ${FOLLOW_UP} Your posts average 140 likes. Following up on: "${FIRST}".`)).toBeVisible({ timeout: 20_000 });
  const call = chatCalls().at(-1)!;
  expect(call.turns).toEqual([
    { role: "user", text: FIRST },
    // Read back from the database, as stored (plain text, no markdown).
    { role: "model", text: `Stub answer to: ${FIRST} Your posts average 140 likes.` },
    { role: "user", text: FOLLOW_UP },
  ]);
  await shot(page, "2-follow-up");
});

test("numbers that aren't in the facts are never shown", async () => {
  // One invented sentence: dropped, the rest shown.
  await ask("[partial] What about saves?");
  await expect(page.getByText("Your posts average 140 likes. Keep posting Reels.")).toBeVisible({ timeout: 20_000 });
  // Mostly invented: not shown at all — an honest answer instead, never a sample.
  await ask("[invent] How did my reach change?");
  await expect(page.getByText("I can't answer that from your data yet. Try asking about a photo or a post.")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/987654|55555/)).toHaveCount(0);
  await expect(page.getByTestId("sample-answer")).toHaveCount(0);
  await shot(page, "3-invented-numbers");
});

test("chats are saved on the server: they open in a fresh browser, with nothing in localStorage", async ({ browser }) => {
  const { context, p } = await freshDevice(browser);
  await p.goto("/ai");
  await expect(chatItem(FIRST, p)).toBeVisible();
  await chatItem(FIRST, p).getByRole("button").first().click();
  await expect(p.getByText(`Following up on: "${FIRST}"`)).toBeVisible();
  await expect(p.getByText("Your posts average 140 likes. Keep posting Reels.")).toBeVisible();
  expect(await p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("lge_ai_chats:")))).toEqual([]);
  await shot(p, "4-fresh-browser");
  await context.close();
});

test("a browser's old local chats are imported once (never sample chats), then rename and delete stick", async ({ browser }) => {
  const { context, p } = await freshDevice(browser);
  await p.goto("/ai");
  await expect(chatItem(FIRST, p)).toBeVisible();
  const local = [
    { id: "e2e-local-1", title: { en: "Ideas from my phone", ar: "Ideas from my phone" }, at: "2026-10-20T09:00:00.000Z", messages: [{ id: "u1", role: "user", text: { en: "Ideas from my phone", ar: "Ideas from my phone" } }, { id: "a1", role: "ai", kind: "text", text: { en: "Try a behind-the-scenes Reel.", ar: "Try a behind-the-scenes Reel." } }] },
    { id: "seed-tannour-1", title: { en: "What should I post tomorrow?", ar: "ماذا أنشر غداً؟" }, at: "2026-10-20T09:00:00.000Z", messages: [] },
  ];
  await p.evaluate(([key, value]) => localStorage.setItem(key, value), [`lge_ai_chats:${businessId}`, JSON.stringify(local)]);
  await p.reload();
  await expect(chatItem("Ideas from my phone", p)).toBeVisible();
  await expect(chatItem("What should I post tomorrow?", p)).toHaveCount(0);
  await expect.poll(() => p.evaluate((key) => localStorage.getItem(key), `lge_ai_chats:${businessId}`)).toBeNull();
  await p.reload();
  await expect(chatItem("Ideas from my phone", p)).toHaveCount(1);
  await chatItem("Ideas from my phone", p).getByRole("button").first().click();
  await expect(p.getByText("Try a behind-the-scenes Reel.")).toBeVisible();
  await context.close();

  // Rename on this device: another device sees the new name.
  await page.goto("/ai");
  await chatItem("Ideas from my phone").getByRole("button", { name: /^Chat options/ }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByRole("dialog").last().getByRole("textbox", { name: "Chat name" }).fill("Reel ideas");
  await page.getByRole("dialog").last().getByRole("button", { name: "Save" }).click();
  await expect(toast("Chat renamed")).toBeVisible();
  await expect.poll(async () => (await pool.query(`SELECT title FROM "AssistantConversation" WHERE "businessId" = $1 AND "clientKey" = 'e2e-local-1'`, [businessId])).rows[0]?.title).toBe("Reel ideas");
  const other = await freshDevice(browser);
  await other.p.goto("/ai");
  await expect(chatItem("Reel ideas", other.p)).toBeVisible();

  // Delete: gone here, after a reload and on the other device.
  await chatItem("Reel ideas").getByRole("button", { name: /^Chat options/ }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("dialog").last().getByRole("button", { name: "Delete" }).click();
  await expect(toast("Chat deleted")).toBeVisible();
  await expect.poll(async () => (await pool.query(`SELECT 1 FROM "AssistantConversation" WHERE "businessId" = $1 AND "clientKey" = 'e2e-local-1'`, [businessId])).rowCount).toBe(0);
  await page.reload();
  await expect(chatItem(FIRST)).toBeVisible();
  await expect(chatItem("Reel ideas")).toHaveCount(0);
  await other.p.reload();
  await expect(chatItem(FIRST, other.p)).toBeVisible();
  await expect(chatItem("Reel ideas", other.p)).toHaveCount(0);
  await other.context.close();
});

test("another business's chat is 404 on every route, and stays as it was", async () => {
  const api = page.request;
  expect((await api.get(`/api/ai-chats/${CAFE_CHAT}`)).status()).toBe(404);
  expect((await api.patch(`/api/ai-chats/${CAFE_CHAT}`, { data: { title: "Mine now" } })).status()).toBe(404);
  expect((await api.post(`/api/ai-chats/${CAFE_CHAT}/messages`, { data: { messages: [{ id: "x1", role: "user", text: { en: "hi", ar: "hi" } }] } })).status()).toBe(404);
  expect((await api.patch(`/api/ai-chats/${CAFE_CHAT}/messages/m1`, { data: { message: { id: "m1", role: "user", text: { en: "changed", ar: "changed" } } } })).status()).toBe(404);
  expect((await api.post("/api/ai-chat", { data: { question: "What did they ask?", chatId: CAFE_CHAT, answerId: "x2" } })).status()).toBe(404);
  expect((await api.delete(`/api/ai-chats/${CAFE_CHAT}`)).status()).toBe(404);
  // Making a chat with their chat's id makes our own (ids are per business); theirs is untouched.
  expect((await api.post("/api/ai-chats", { data: { id: CAFE_CHAT, title: { en: "Ours", ar: "Ours" }, messages: [] } })).status()).toBe(201);
  const theirs = await pool.query(`SELECT c.title, m.content FROM "AssistantConversation" c JOIN "AssistantMessage" m ON m."conversationId" = c.id WHERE c.id = 'e2e-cafe-conv'`);
  expect(theirs.rows).toEqual([{ title: "Theirs", content: "Their secret question" }]);
  expect((await api.delete(`/api/ai-chats/${CAFE_CHAT}`)).status()).toBe(200);
  // A real business can't add the demo's sample chats.
  expect((await api.post("/api/ai-chats/import", { data: { sample: true, chats: [] } })).status()).toBe(404);
  // Not signed in: 401.
  const anonymous = await page.context().browser()!.newContext();
  expect((await anonymous.request.get(new URL("/api/ai-chats", page.url()).toString())).status()).toBe(401);
  await anonymous.close();
});

test("saved messages keep only images from our storage or Instagram's CDN", async () => {
  const api = page.request;
  const message = {
    id: "img-1",
    role: "user",
    text: { en: "Like this", ar: "Like this" },
    refThumb: "https://evil.example/pixel.gif",
    reference: { key: "c:1", competitorId: "c", handle: "dalla", name: "Dalla", avatarUrl: "https://tracker.example/a.png", post: { id: "1", mediaUrl: "https://scontent.cdninstagram.com/v/x.jpg", permalink: "javascript:alert(1)" } },
  };
  expect((await api.post("/api/ai-chats", { data: { id: "e2e-links", title: { en: "Links", ar: "Links" }, messages: [message] } })).status()).toBe(201);
  const stored = (await (await api.get("/api/ai-chats/e2e-links")).json()).data.messages[0];
  expect(stored.refThumb).toBeUndefined();
  expect(stored.reference.avatarUrl).toBeUndefined();
  expect(stored.reference.post.permalink).toBeUndefined();
  expect(stored.reference.post.mediaUrl).toBe("https://scontent.cdninstagram.com/v/x.jpg");
  // An update can't bring one back either.
  await api.patch("/api/ai-chats/e2e-links/messages/img-1", { data: { message: { ...message, refThumb: "https://evil.example/2.gif" } } });
  const raw = await pool.query<{ payload: { refThumb?: string } }>(`SELECT m.payload FROM "AssistantMessage" m JOIN "AssistantConversation" c ON c.id = m."conversationId" WHERE c."businessId" = $1 AND c."clientKey" = 'e2e-links'`, [businessId]);
  expect(raw.rows[0].payload.refThumb).toBeUndefined();
  expect((await api.delete("/api/ai-chats/e2e-links")).status()).toBe(200);
});

test("with the AI chat switched off, every chat route is 404", async () => {
  await pool.query(
    `INSERT INTO "FeaturePermission" (id, "businessId", "featureKey", enabled) VALUES ('e2e-aichat-off', $1, 'aiChat', false)
     ON CONFLICT ("businessId", "featureKey") DO UPDATE SET enabled = false`,
    [businessId],
  );
  await pool.query(`UPDATE "Business" SET "permissionsUpdatedAt" = now() WHERE id = $1`, [businessId]);
  const api = page.request;
  try {
    expect((await api.get("/api/ai-chats")).status()).toBe(404);
    expect((await api.post("/api/ai-chat", { data: { question: "Anything?" } })).status()).toBe(404);
    expect((await api.post("/api/ai-chats/import", { data: { chats: [] } })).status()).toBe(404);
  } finally {
    await pool.query(`DELETE FROM "FeaturePermission" WHERE "businessId" = $1 AND "featureKey" = 'aiChat'`, [businessId]);
    await pool.query(`UPDATE "Business" SET "permissionsUpdatedAt" = now() WHERE id = $1`, [businessId]);
  }
  expect((await api.get("/api/ai-chats")).status()).toBe(200);
});

test("admin preview shows the saved chats read-only", async ({ browser }) => {
  const { context, p: admin } = await freshDevice(browser, ADMIN);
  await admin.goto(`/admin/clients/${businessId}`);
  await admin.getByRole("button", { name: "Preview as this client" }).click();
  await admin.waitForURL(/\/gallery$/);
  await admin.goto("/ai");
  const list = admin.getByRole("navigation", { name: "Chats" });
  await expect(chatItem(FIRST, admin)).toBeVisible();
  await expect(list.getByRole("button", { name: /^Chat options/ })).toHaveCount(0);
  await chatItem(FIRST, admin).getByRole("button").first().click();
  await expect(admin.getByText(`Following up on: "${FIRST}"`)).toBeVisible();
  await expect(composer(admin)).toBeDisabled();
  await expect(admin.getByRole("note")).toHaveText("Preview is read-only");
  // The preview reads; the client's chat routes aren't for admins.
  expect((await admin.request.get(`/api/admin/preview/${businessId}/ai-chats/${CAFE_CHAT}`)).status()).toBe(404);
  expect((await admin.request.post("/api/ai-chats", { data: { id: "admin-chat", title: { en: "x", ar: "x" }, messages: [] } })).status()).toBeGreaterThanOrEqual(400);
  await shot(admin, "5-admin-preview");
  await admin.getByRole("button", { name: "Exit preview" }).click();
  await context.close();
  expect((await pool.query(`SELECT 1 FROM "AssistantConversation" WHERE "clientKey" = 'admin-chat'`)).rowCount).toBe(0);
});

test("phone, Arabic: the chat opens in the drawer, right to left", async ({ browser }) => {
  const { context, p } = await freshDevice(browser, BOUTIQUE, { viewport: { width: 390, height: 844 } });
  await p.goto("/ai");
  const language = async () => {
    await p.getByTestId("profile-menu-trigger").filter({ visible: true }).click();
    await p.getByTestId("menu-language").click();
  };
  await language();
  await expect(p.locator("html")).toHaveAttribute("dir", "rtl");
  await p.getByRole("button", { name: "المحادثات" }).click();
  await chatItem(FIRST, p).getByRole("button").first().click();
  await expect(p.getByText(`Following up on: "${FIRST}"`)).toBeVisible();
  await ask("كيف أداء منشوراتي؟", p, "اسأل أي شيء…");
  await expect(p.getByText("إجابة تجريبية: كيف أداء منشوراتي؟ متوسط الإعجابات 140.")).toBeVisible({ timeout: 20_000 });
  expect(chatCalls().at(-1)!.system).toMatch(/Reply in Arabic/);
  expect(await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  await shot(p, "6-phone-arabic");
  // Back to English (the language is saved for the login).
  await language();
  await expect(p.locator("html")).toHaveAttribute("dir", "ltr");
  await context.close();
});
