import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { startGeminiStub } from "./gemini-stub";

/**
 * Admin AI keys (System → AI settings, and each client's own key), end to end:
 * - the platform key and a client key are saved encrypted ("v1." in the database), the browser and every API answer
 *   show only the last 4 characters, and a client login can't reach the routes;
 * - "Test key" makes one small Gemini call (the local stub) and says OK or why not;
 * - an AI call uses the client's key, then the platform key after the client key is removed, then the
 *   environment's key once the platform key is removed too (the stub records the key header of every request);
 * - who changed the key is recorded (activity log), never the key itself;
 * - the cards read in Arabic (RTL) and on a phone.
 * Gemini stub on port 4010; screenshots go to E2E_SHOTS_DIR (default test-results/admin-ai-keys-shots).
 */

const ADMIN = { email: "admin@localgrowth.dev", password: "Admin@123" };
const USER = { email: "user@mathanetbaity.dev", password: "User@123" };
const SHOTS = process.env.E2E_SHOTS_DIR ?? "test-results/admin-ai-keys-shots";
const RUN = randomUUID().replace(/-/g, "").slice(0, 8);
const PLATFORM_KEY = `AIzaPlatform${RUN}${"p".repeat(16)}WXYZ`;
const CLIENT_KEY = `AIzaClient${RUN}${"c".repeat(18)}9876`;
const ENV_KEY = "e2e-not-a-real-key";

test.describe.configure({ mode: "serial", timeout: 120_000 });

let stub: Awaited<ReturnType<typeof startGeminiStub>>;
let pool: Pool;
let clientId: string;

test.beforeAll(async () => {
  stub = await startGeminiStub();
  pool = new Pool({ connectionString: (process.env.DATABASE_URL ?? "").replace(/\?.*$/, "") });
  clientId = (await pool.query<{ businessId: string }>(`SELECT "businessId" FROM "User" WHERE email = $1`, [USER.email])).rows[0].businessId;
  await pool.query(`DELETE FROM "AiKey"`);
});

test.afterAll(async () => {
  await pool.query(`DELETE FROM "AiKey"`);
  await stub.close();
  await pool.end();
});

async function login(browser: Browser, who: { email: string; password: string }, extra: { locale?: "ar"; viewport?: { width: number; height: number } } = {}) {
  const context = await browser.newContext(extra.viewport ? { viewport: extra.viewport } : {});
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel(/Username or email|اسم المستخدم أو البريد الإلكتروني/).fill(who.email);
  await page.getByLabel(/^(Password|كلمة المرور)$/).fill(who.password);
  await page.locator("form").getByRole("button", { name: /Log in|تسجيل الدخول/ }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  // The saved language wins over the cookie, so switch it in the account (restored by the test).
  if (extra.locale) {
    await context.addCookies([{ name: "lge_locale", value: "ar", url: `http://localhost:${process.env.E2E_PORT ?? 3001}` }]);
    await page.request.patch("/api/me/preferences", { data: { language: "ar" } });
  }
  return { context, page };
}

const card = (page: Page, scope: "platform" | "business") => page.getByTestId(`ai-key-${scope}`);

async function saveKey(page: Page, scope: "platform" | "business", key: string) {
  await card(page, scope).getByTestId("ai-key-input").fill(key);
  await card(page, scope).getByTestId("ai-key-save").click();
  await expect(card(page, scope).getByTestId("ai-key-saved")).toContainText(key.slice(-4));
}

test("the platform key: validated, saved encrypted, shown as its last 4 characters, tested", async ({ browser }) => {
  const { context, page } = await login(browser, ADMIN);
  await page.goto("/admin/system");
  const platform = card(page, "platform");
  await expect(platform).toContainText("AI settings");
  // No key saved here: the environment's key is in use.
  await expect(platform.getByTestId("ai-key-source")).toContainText("Server environment key");
  await expect(platform.getByTestId("ai-key-saved")).toContainText("No key saved here.");

  // A clearly wrong key is refused before anything is sent.
  await platform.getByTestId("ai-key-input").fill("short");
  await platform.getByTestId("ai-key-save").click();
  await expect(platform.getByTestId("ai-key-problem")).toContainText("too short");
  await platform.getByTestId("ai-key-input").fill("has spaces inside the pasted key text");
  await platform.getByTestId("ai-key-save").click();
  await expect(platform.getByTestId("ai-key-problem")).toContainText("no spaces");

  // Test the typed key before saving it: one small call to Gemini (the stub).
  await platform.getByTestId("ai-key-input").fill(PLATFORM_KEY);
  const before = stub.calls.length;
  await platform.getByTestId("ai-key-test").click();
  await expect(platform.getByTestId("ai-key-result")).toContainText("OK: the key works.");
  expect(stub.calls.length).toBe(before + 1);
  expect(stub.calls.at(-1)?.key).toBe(PLATFORM_KEY);

  // Save it.
  await platform.getByTestId("ai-key-save").click();
  await expect(platform.getByTestId("ai-key-saved")).toContainText("ends in WXYZ");
  await expect(platform.getByTestId("ai-key-saved")).toContainText("Last changed by");
  await expect(platform.getByTestId("ai-key-source")).toContainText("Platform key");
  await expect(platform.getByTestId("ai-key-input")).toHaveValue("");

  // Encrypted at rest; never in an API answer; who changed it is recorded, the key is not.
  const row = (await pool.query<{ keyEncrypted: string; last4: string; updatedById: string | null }>(`SELECT "keyEncrypted", last4, "updatedById" FROM "AiKey" WHERE "scopeKey" = 'platform'`)).rows[0];
  expect(row.keyEncrypted.startsWith("v1.")).toBe(true);
  expect(row.keyEncrypted).not.toContain(PLATFORM_KEY);
  expect(row.last4).toBe("WXYZ");
  expect(row.updatedById).toBeTruthy();
  const body = await (await page.request.get("/api/admin/ai-settings")).text();
  expect(body).not.toContain(PLATFORM_KEY);
  expect(body).toContain("WXYZ");
  const events = (await pool.query(`SELECT action, "userId" FROM "AiKeyEvent" WHERE "scopeKey" = 'platform' ORDER BY "createdAt"`)).rows;
  expect(events.map((e) => e.action)).toContain("SET");
  expect(events.every((e) => e.userId)).toBe(true);
  const activity = (await pool.query(`SELECT details::text AS d FROM "ActivityLog" WHERE action = 'ai_key.set'`)).rows;
  expect(activity.length).toBeGreaterThan(0);
  expect(activity.every((a) => !a.d.includes(PLATFORM_KEY))).toBe(true);

  // Testing with the field empty tests the key in use; a failing call says why.
  stub.state.fail = true;
  await platform.getByTestId("ai-key-test").click();
  await expect(platform.getByTestId("ai-key-result")).toContainText("The key didn't work.");
  stub.state.fail = false;
  await platform.getByTestId("ai-key-test").click();
  await expect(platform.getByTestId("ai-key-result")).toContainText("OK: the key works.");
  expect(stub.calls.at(-1)?.key).toBe(PLATFORM_KEY);

  await page.screenshot({ path: `${SHOTS}/system-ai-settings-light.png`, fullPage: false });
  await context.addCookies([{ name: "lge_theme", value: "dark", url: page.url() }]);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(card(page, "platform")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/system-ai-settings-dark.png`, fullPage: false });
  await context.close();
});

test("a client's own key overrides the platform key; removing it goes back; clients can't reach any of it", async ({ browser }) => {
  const { context, page } = await login(browser, ADMIN);
  await page.goto(`/admin/clients/${clientId}`);
  const own = card(page, "business");
  await expect(own).toContainText("AI key for this client");
  await expect(own.getByTestId("ai-key-source")).toContainText("Platform key");
  await saveKey(page, "business", CLIENT_KEY);
  await expect(own.getByTestId("ai-key-source")).toContainText("This client's own key");
  const row = (await pool.query<{ keyEncrypted: string }>(`SELECT "keyEncrypted" FROM "AiKey" WHERE "scopeKey" = $1`, [`business:${clientId}`])).rows[0];
  expect(row.keyEncrypted.startsWith("v1.")).toBe(true);
  expect(await (await page.request.get(`/api/admin/businesses/${clientId}/ai-key`)).text()).not.toContain(CLIENT_KEY);

  // "Test key" with the field empty uses the client's key.
  await own.getByTestId("ai-key-test").click();
  await expect(own.getByTestId("ai-key-result")).toContainText("OK");
  expect(stub.calls.at(-1)?.key).toBe(CLIENT_KEY);
  await page.screenshot({ path: `${SHOTS}/client-ai-key-light.png`, fullPage: false });

  // The client's real AI call uses the client's key.
  const client = await login(browser, USER);
  await client.page.goto("/ai");
  const composer = client.page.getByRole("textbox", { name: "Ask anything…" });
  await composer.fill("Anything else?");
  await composer.press("Enter");
  await expect.poll(() => stub.calls.filter((c) => c.kind === "chat").at(-1)?.key).toBe(CLIENT_KEY);

  // The client can't read or change any key.
  for (const [method, url] of [["get", "/api/admin/ai-settings"], ["get", `/api/admin/businesses/${clientId}/ai-key`], ["put", "/api/admin/ai-settings"], ["post", "/api/admin/ai-keys/test"]] as const) {
    const res = await client.page.request[method](url, method === "get" ? {} : { data: { apiKey: PLATFORM_KEY } });
    expect(res.status(), `${method} ${url}`).toBe(403);
  }
  expect(await (await client.page.request.get("/api/me")).text()).not.toContain("AIza");
  await client.context.close();

  // Removing the client's key: the platform key again.
  await own.getByTestId("ai-key-remove").click();
  await expect(own.getByTestId("ai-key-saved")).toContainText("No key saved here.");
  await expect(own.getByTestId("ai-key-source")).toContainText("Platform key");
  await context.close();

  const again = await login(browser, USER);
  await again.page.goto("/ai");
  const next = again.page.getByRole("textbox", { name: "Ask anything…" });
  await next.fill("Anything else, please?");
  await next.press("Enter");
  await expect.poll(() => stub.calls.filter((c) => c.kind === "chat").at(-1)?.key).toBe(PLATFORM_KEY);
  await again.context.close();
});

test("removing the platform key falls back to the environment key; Arabic and phone", async ({ browser }) => {
  const { context, page } = await login(browser, ADMIN);
  await page.goto("/admin/system");
  const platform = card(page, "platform");
  await platform.getByTestId("ai-key-remove").click();
  await expect(platform.getByTestId("ai-key-source")).toContainText("Server environment key");
  await platform.getByTestId("ai-key-test").click();
  await expect(platform.getByTestId("ai-key-result")).toContainText("OK");
  expect(stub.calls.at(-1)?.key).toBe(ENV_KEY);
  expect((await pool.query(`SELECT 1 FROM "AiKey"`)).rowCount).toBe(0);
  await context.close();

  // Arabic (RTL) on a phone, with a saved key shown.
  const phone = await login(browser, ADMIN, { locale: "ar", viewport: { width: 390, height: 844 } });
  await phone.page.goto("/admin/system");
  await expect(phone.page.locator("html")).toHaveAttribute("dir", "rtl");
  const ar = card(phone.page, "platform");
  await expect(ar).toContainText("إعدادات الذكاء الاصطناعي");
  await saveKey(phone.page, "platform", PLATFORM_KEY);
  await ar.scrollIntoViewIfNeeded();
  await ar.screenshot({ path: `${SHOTS}/system-ai-settings-ar-phone.png` });
  expect(await phone.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await phone.page.getByTestId("ai-key-remove").first().click();
  await phone.page.request.patch("/api/me/preferences", { data: { language: "en" } });
  await phone.context.close();
});
