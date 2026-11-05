import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

/**
 * Sign-up and login with a username, end to end (see playwright.config.ts):
 * - sign-up asks for a username and password only; the rules show clear messages (English letters, numbers, "_"
 *   and "." — 3 to 30 characters), a taken username is refused without regard to case, and a finished sign-up
 *   stores the lower-case username (no email, no verification banner);
 * - login takes a username (any case) or the email of an older account (the admin's);
 * - there is no "Forgot password" email flow any more, and no verification pages;
 * - an admin sets a client's password from the client page and the old one stops working.
 * Uses its own client address (x-forwarded-for) so it doesn't spend the sign-up limit of onboarding.spec.
 * Screenshots go to E2E_SHOTS_DIR (default test-results/auth-shots).
 */

const RUN = randomUUID().replace(/-/g, "").slice(0, 6);
const PASSWORD = "Growth2026!";
const ADMIN = { email: "admin@localgrowth.dev", password: "Admin@123" };
const USER_EMAIL = "user@mathanetbaity.dev";
const USER_PASSWORD = "User@123";
const SHOTS = process.env.E2E_SHOTS_DIR ?? "test-results/auth-shots";
const IP = "10.20.30.40";

test.describe.configure({ mode: "serial", timeout: 120_000 });

let pool: Pool;
test.beforeAll(() => {
  pool = new Pool({ connectionString: (process.env.DATABASE_URL ?? "").replace(/\?.*$/, "") });
});
test.afterAll(async () => {
  await pool.query(`UPDATE "User" SET username = NULL WHERE email = $1`, [USER_EMAIL]);
  await pool.end();
});

async function fresh(browser: Browser, options: { ar?: boolean; dark?: boolean; phone?: boolean } = {}): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    extraHTTPHeaders: { "x-forwarded-for": IP },
    ...(options.phone && { viewport: { width: 390, height: 844 } }),
  });
  const base = new URL(process.env.E2E_BASE_URL ?? `http://localhost:${process.env.E2E_PORT ?? 3001}`);
  const cookies = [
    ...(options.ar ? [{ name: "lge_locale", value: "ar", url: base.origin }] : []),
    ...(options.dark ? [{ name: "lge_theme", value: "dark", url: base.origin }] : []),
  ];
  if (cookies.length) await context.addCookies(cookies);
  return { context, page: await context.newPage() };
}

async function logIn(page: Page, identifier: string, password: string) {
  await page.goto("/login");
  await page.getByLabel(/Username or email|اسم المستخدم أو البريد الإلكتروني/).fill(identifier);
  await page.getByLabel(/^(Password|كلمة المرور)$/).fill(password);
  await page.locator("form").getByRole("button", { name: /Log in|تسجيل الدخول/ }).click();
}

test("sign-up shows the username rules; a taken username (any case) is refused; a finished sign-up keeps the lower-case username", async ({ browser }) => {
  const taken = `taken_${RUN}`;
  await pool.query(`UPDATE "User" SET username = $1 WHERE email = 'cafe@localgrowth.dev'`, [taken]);
  const { context, page } = await fresh(browser);
  await page.goto("/signup");
  await expect(page.getByLabel("Email")).toHaveCount(0);
  const username = page.locator('input[name="username"]');
  const hint = page.getByTestId("username-hint");
  const submit = page.getByRole("button", { name: "Continue with Instagram" });

  await expect(hint).toContainText("3–30 characters");
  await page.locator('input[name="password"]').fill(PASSWORD);
  await username.fill("ab");
  await username.blur();
  await expect(hint).toContainText("Too short: use at least 3 characters.");
  await expect(submit).toBeDisabled();
  await username.fill("a".repeat(31));
  await expect(hint).toContainText("Too long: use at most 30 characters.");
  for (const bad of ["has space", "dash-name", "name@mail", "اسم_عربي"]) {
    await username.fill(bad);
    await expect(hint).toContainText("English letters, numbers, _ and . (no spaces)");
    await expect(submit).toBeDisabled();
  }
  await page.screenshot({ path: `${SHOTS}/signup-rules-light.png` });

  // Taken, whatever the case: the server says so and nothing is stored.
  await username.fill(taken.toUpperCase());
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.locator('p[role="alert"]')).toContainText("This username is already taken. Try another one.");
  expect((await pool.query(`SELECT 1 FROM "PendingSignup" WHERE email = $1`, [`${taken}@users.invalid`])).rowCount).toBe(0);

  // A free one (mixed case) goes on to Instagram; the account appears only when it connects.
  const mine = `Auth_User.${RUN}`;
  await username.fill(mine);
  await submit.click();
  await page.waitForURL(/\/signup\/demo-instagram/);
  expect((await pool.query(`SELECT 1 FROM "User" WHERE username = $1`, [mine.toLowerCase()])).rowCount).toBe(0);
  await page.locator("#demo-handle").fill(`authbakes_${RUN}`);
  await page.getByRole("button", { name: "Allow and connect" }).click();
  await page.waitForURL(/\/onboarding/);
  // No verification banner or email prompt anywhere.
  await expect(page.getByText(/verify your email/i)).toHaveCount(0);

  const row = (await pool.query<{ username: string; email: string; name: string }>(`SELECT username, email, name FROM "User" WHERE username = $1`, [mine.toLowerCase()])).rows[0];
  expect(row).toEqual({ username: mine.toLowerCase(), email: `${mine.toLowerCase()}@users.invalid`, name: mine.toLowerCase() });
  // The placeholder address is never shown; the profile menu shows the username.
  await context.close();

  // The same username in other letters is now refused too, on the page.
  const second = await fresh(browser);
  await second.page.goto("/signup");
  await second.page.locator('input[name="username"]').fill(mine.toUpperCase());
  await second.page.locator('input[name="password"]').fill(PASSWORD);
  await second.page.getByRole("button", { name: "Continue with Instagram" }).click();
  await expect(second.page.locator('p[role="alert"]')).toContainText("already taken");
  await second.context.close();

  // Log in with the username in other letters.
  const again = await fresh(browser);
  await logIn(again.page, mine.toUpperCase(), PASSWORD);
  await again.page.waitForURL((url) => !url.pathname.startsWith("/login"));
  await again.context.close();
  await pool.query(`UPDATE "User" SET username = NULL WHERE email = 'cafe@localgrowth.dev'`);
});

test("login takes a username or the email of an older account; no password-reset email, no verification pages", async ({ browser }) => {
  const name = `mathanet_${RUN}`;
  await pool.query(`UPDATE "User" SET username = $1 WHERE email = $2`, [name, USER_EMAIL]);

  // By username (any case), then by email.
  for (const identifier of [name.toUpperCase(), USER_EMAIL]) {
    const { context, page } = await fresh(browser);
    await logIn(page, identifier, USER_PASSWORD);
    await page.waitForURL((url) => !url.pathname.startsWith("/login"));
    await context.close();
  }

  // Wrong password / unknown name: the same message, no hint which was wrong.
  const bad = await fresh(browser);
  await logIn(bad.page, name, "Wrong-Password-1");
  await expect(bad.page.locator('p[role="alert"]')).toContainText("password was incorrect");
  await logIn(bad.page, `nobody_${RUN}`, "Wrong-Password-1");
  await expect(bad.page.locator('p[role="alert"]')).toContainText("password was incorrect");
  // The login page: one field for both, a hint instead of a "Forgot password?" link.
  await expect(bad.page.getByText("Ask your account manager to reset it.")).toBeVisible();
  await expect(bad.page.getByRole("link", { name: /Forgot password/ })).toHaveCount(0);
  await bad.page.screenshot({ path: `${SHOTS}/login-light.png` });
  await bad.context.close();

  // The admin still logs in with the email; the email-based pages are gone.
  const admin = await fresh(browser);
  await logIn(admin.page, ADMIN.email, ADMIN.password);
  await admin.page.waitForURL(/\/admin/);
  // The pages are gone: a logged-out visitor is simply sent to the login page (not followed: AUTH_URL may point elsewhere).
  const visitor = await fresh(browser);
  for (const path of ["/forgot-password", "/reset-password", "/verify-email"]) {
    const res = await visitor.page.request.get(path, { maxRedirects: 0 });
    expect(res.status(), path).toBe(307);
    expect(res.headers().location, path).toMatch(/\/login$/);
  }
  await visitor.context.close();
  for (const [method, url] of [["post", "/api/password-reset/request"], ["post", "/api/password-reset/confirm"], ["get", "/api/me/verify-email"]] as const) {
    expect((await admin.page.request[method](url, method === "post" ? { data: {} } : {})).status(), url).toBe(404);
  }
  await admin.context.close();

  // Arabic (RTL), phone, dark: the login and sign-up cards.
  const phone = await fresh(browser, { ar: true, dark: true, phone: true });
  await phone.page.goto("/login");
  await expect(phone.page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(phone.page.getByLabel("اسم المستخدم أو البريد الإلكتروني")).toBeVisible();
  await phone.page.screenshot({ path: `${SHOTS}/login-ar-dark-phone.png` });
  await phone.page.goto("/signup");
  await expect(phone.page.getByLabel("اسم المستخدم", { exact: true })).toBeVisible();
  await phone.page.locator('input[name="username"]').fill("ab");
  await phone.page.locator('input[name="username"]').blur();
  await expect(phone.page.getByTestId("username-hint")).toContainText("قصير جداً");
  expect(await phone.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await phone.page.screenshot({ path: `${SHOTS}/signup-ar-dark-phone.png` });
  await phone.context.close();
});

test("an admin sets a client's password from the client page; the old password stops working", async ({ browser }) => {
  const clientId = (await pool.query<{ businessId: string }>(`SELECT "businessId" FROM "User" WHERE email = $1`, [USER_EMAIL])).rows[0].businessId;
  const email = `reset-${RUN}@example.com`;
  const OLD = "Old-Password-1";
  const NEW = "New-Password-2";
  const admin = await fresh(browser);
  await logIn(admin.page, ADMIN.email, ADMIN.password);
  await admin.page.waitForURL(/\/admin/);
  const created = await admin.page.request.post("/api/admin/users", { data: { email, name: `Reset Test ${RUN}`, password: OLD, role: "user", businessId: clientId } });
  expect(created.status()).toBe(201);

  await admin.page.goto(`/admin/clients/${clientId}`);
  const row = admin.page.locator("li").filter({ hasText: `Reset Test ${RUN}` });
  await row.getByRole("button", { name: `Actions for Reset Test ${RUN}` }).click();
  // No "Email a reset link" any more.
  await expect(admin.page.getByRole("menuitem", { name: /Email a reset link/ })).toHaveCount(0);
  await admin.page.getByRole("menuitem", { name: "Set new password" }).click();
  await admin.page.locator("#admin-new-password").fill(NEW);
  await admin.page.screenshot({ path: `${SHOTS}/admin-set-password-light.png` });
  await admin.page.getByRole("dialog").getByRole("button", { name: "Set new password" }).click();
  await expect(admin.page.getByRole("dialog")).toHaveCount(0);

  const oldTry = await fresh(browser);
  await logIn(oldTry.page, email, OLD);
  await expect(oldTry.page.locator('p[role="alert"]')).toContainText("password was incorrect");
  await oldTry.context.close();
  const newTry = await fresh(browser);
  await logIn(newTry.page, email, NEW);
  await newTry.page.waitForURL((url) => !url.pathname.startsWith("/login"));
  await newTry.context.close();
  // Logged: who set it (never the password).
  const log = (await pool.query(`SELECT details::text AS d FROM "ActivityLog" WHERE action = 'admin.user_password_reset' ORDER BY "createdAt" DESC LIMIT 1`)).rows[0];
  expect(log.d).not.toContain(NEW);
  await admin.context.close();
  await pool.query(`DELETE FROM "User" WHERE email = $1`, [email]);
});

test("admin 'New client' creates the login with a username (email optional); duplicates are refused", async ({ browser }) => {
  const owner = `newclient_${RUN}`;
  const admin = await fresh(browser);
  await logIn(admin.page, ADMIN.email, ADMIN.password);
  await admin.page.waitForURL(/\/admin/);
  await admin.page.goto("/admin/clients");
  await admin.page.getByRole("button", { name: "New client" }).first().click();
  const dialog = admin.page.getByRole("dialog");
  await dialog.getByLabel("Business name").fill(`New Client ${RUN}`);
  await dialog.getByLabel("Instagram handle").fill(`newclient.${RUN}`);
  await dialog.getByLabel("Location").fill("Kuwait City");
  await dialog.locator("#nc-owner-username").fill("no spaces!");
  await dialog.locator("#nc-owner-password").fill(PASSWORD);
  await dialog.getByRole("button", { name: "Create client" }).click();
  await expect(dialog.locator('p[role="alert"]')).toContainText("English letters");
  await dialog.locator("#nc-owner-username").fill(owner.toUpperCase());
  await expect(dialog.getByLabel("Email (optional)")).toHaveValue("");
  await dialog.screenshot({ path: `${SHOTS}/admin-new-client-light.png` });
  await dialog.getByRole("button", { name: "Create client" }).click();
  await admin.page.waitForURL(/\/admin\/clients\/[^/]+$/);
  const row = (await pool.query<{ username: string; email: string }>(`SELECT username, email FROM "User" WHERE username = $1`, [owner])).rows[0];
  expect(row).toEqual({ username: owner, email: `${owner}@users.invalid` });

  // The new login signs in with its username; a duplicate (any case) is refused by the API.
  const client = await fresh(browser);
  await logIn(client.page, owner, PASSWORD);
  await client.page.waitForURL((url) => !url.pathname.startsWith("/login"));
  await client.context.close();
  const dup = await admin.page.request.post("/api/admin/users", { data: { username: owner.toUpperCase(), name: "Dup", password: PASSWORD, role: "admin" } });
  expect(dup.status()).toBe(409);
  const emailOnly = await admin.page.request.post("/api/admin/users", { data: { email: `emailonly-${RUN}@example.com`, name: "Email only", password: PASSWORD, role: "admin" } });
  expect(emailOnly.status()).toBe(201);
  expect((await admin.page.request.post("/api/admin/users", { data: { name: "None", password: PASSWORD, role: "admin" } })).status()).toBe(400);
  await admin.context.close();

  await pool.query(`DELETE FROM "User" WHERE username = $1 OR email = $2`, [owner, `emailonly-${RUN}@example.com`]);
  await pool.query(`DELETE FROM "Business" WHERE name = $1`, [`New Client ${RUN}`]);
});
