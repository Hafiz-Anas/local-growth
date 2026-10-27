import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

/**
 * Accounts on this device (see playwright.config.ts for how to run): one login = one Instagram account,
 * and the browser remembers several logins (sealed httpOnly cookie + RememberedLogin rows):
 * - logging in remembers the login; "Add account" → log in adds a second one and keeps the first;
 * - switching back and forth signs in on the server, lands on the Gallery with "Switched to @handle";
 * - "Create a new account" runs sign-up, Instagram and onboarding while the first logins stay remembered;
 * - a changed password, an expired row, a tampered cookie or a login from another device are refused;
 * - removing a login from the device, "Log out of @handle" (moves on to another login) and
 *   "Log out of all accounts";
 * - Arabic on a phone; the admin's System page no longer has "Instagram accounts per login".
 * Uses the seeded Dalla & Bean and Noor Boutique logins (passwords unchanged) plus one new sign-up, whose
 * business is deleted afterwards. Reads/changes RememberedLogin rows in the e2e database (DATABASE_URL).
 */

const CAFE = { email: "cafe@localgrowth.dev", password: "User@123", handle: "dallabean.kw" };
const BOUTIQUE = { email: "boutique@localgrowth.dev", password: "User@123", handle: "noorboutique.kw" };
const OTHER = { email: "user@mathanetbaity.dev", password: "User@123" };
const ADMIN = { email: "admin@localgrowth.dev", password: "Admin@123" };
const RUN = randomUUID().slice(0, 6);
const NEW = { email: `device-${RUN}@example.com`, password: "Growth2026!", handle: `devicebakes_${RUN}` };
const NEW_PASSWORD = "Growth2027!new";
const COOKIE = "lge_device_logins";

test.describe.configure({ mode: "serial" });

let pool: Pool;
let device: BrowserContext;
let page: Page;
let newBusinessId: string | null = null;

test.beforeAll(async ({ browser }) => {
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) throw new Error("Set DATABASE_URL to the local e2e database.");
  pool = new Pool({ connectionString: url.replace(/\?.*$/, "") });
  // Logins other specs' browsers remembered for these users would skew the row counts below.
  await pool.query(`DELETE FROM "RememberedLogin" WHERE "userId" IN (SELECT id FROM "User" WHERE email = ANY($1))`, [[CAFE.email, BOUTIQUE.email]]);
  device = await browser.newContext();
  page = await device.newPage();
});

test.afterAll(async ({ browser }) => {
  if (newBusinessId) {
    const { context: admin } = await signedIn(browser, ADMIN);
    await admin.request.delete(`/api/admin/businesses/${newBusinessId}`);
    await admin.close();
  }
  await pool?.query(`DELETE FROM "RememberedLogin" WHERE "userId" IN (SELECT id FROM "User" WHERE email = ANY($1))`, [[CAFE.email, BOUTIQUE.email, OTHER.email, NEW.email]]);
  await device?.close();
  await pool?.end();
});

async function fillLogin(p: Page, who: { email: string; password: string }) {
  await p.getByLabel("Email").fill(who.email);
  await p.getByLabel("Password", { exact: true }).fill(who.password);
  await p.getByRole("button", { name: "Log in" }).click();
  await p.waitForURL((url) => !url.pathname.startsWith("/login"));
}

async function signedIn(browser: Browser, who: { email: string; password: string }) {
  const context = await browser.newContext();
  const p = await context.newPage();
  await p.goto("/login");
  await fillLogin(p, who);
  return { context, page: p };
}

const switcher = (p: Page) => p.getByTestId("account-switcher");
const sheet = (p: Page) => p.getByTestId("account-switcher-menu");
const rows = (p: Page) => sheet(p).getByTestId("account-row");
const row = (p: Page, handle: string) => rows(p).filter({ hasText: `@${handle}` });

async function openSwitcher(p: Page) {
  await switcher(p).click();
  await expect(sheet(p)).toBeVisible();
  await expect(rows(p).first()).toBeVisible();
}

async function addByLogin(p: Page, who: { email: string; password: string; handle: string }) {
  await openSwitcher(p);
  await sheet(p).getByTestId("account-add").click();
  await sheet(p).getByTestId("account-add-login").click();
  await p.waitForURL(/\/login\?add=1/);
  await expect(p.getByTestId("adding-account")).toBeVisible();
  await fillLogin(p, who);
  await expect(switcher(p)).toContainText(`@${who.handle}`);
}

const me = async (p: Page) => (await (await p.request.get("/api/me")).json()).data?.user?.email as string | undefined;
const deviceList = async (p: Page) => (await (await p.request.get("/api/device-accounts")).json()).data as { items: Array<{ id: string; handle: string | null; active: boolean }> };
const loginIdOf = async (p: Page, handle: string) => (await deviceList(p)).items.find((a) => a.handle === handle)!.id;
const rowsOf = async (email: string) =>
  (await pool.query<{ id: string }>(`SELECT r.id FROM "RememberedLogin" r JOIN "User" u ON u.id = r."userId" WHERE u.email = $1`, [email])).rows.map((r) => r.id);

test("logging in remembers the login in a sealed httpOnly cookie; “Add account” → log in keeps both", async () => {
  await page.goto("/login");
  await fillLogin(page, CAFE);
  await page.goto("/gallery");
  await expect(switcher(page)).toContainText(`@${CAFE.handle}`);

  const cookie = (await device.cookies()).find((c) => c.name === COOKIE);
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.value).not.toContain(CAFE.email);
  // Not readable from the page.
  expect(await page.evaluate((name) => document.cookie.includes(name), COOKIE)).toBe(false);
  expect(await page.evaluate(() => JSON.stringify(window.localStorage))).not.toContain("lge_device");

  await openSwitcher(page);
  await expect(rows(page)).toHaveCount(1);
  await expect(row(page, CAFE.handle)).toHaveAttribute("data-active", "true");
  await expect(row(page, CAFE.handle).getByTestId("account-status")).toContainText("Needs attention");
  await expect(sheet(page).getByTestId("account-logout-all")).toHaveCount(0);
  await page.keyboard.press("Escape");

  await addByLogin(page, BOUTIQUE);
  expect(await me(page)).toBe(BOUTIQUE.email);
  await openSwitcher(page);
  await expect(rows(page)).toHaveCount(2);
  await expect(row(page, BOUTIQUE.handle)).toHaveAttribute("data-active", "true");
  await expect(row(page, CAFE.handle).getByTestId("account-status")).toContainText("Needs attention");
  await expect(row(page, BOUTIQUE.handle).getByTestId("account-status")).toContainText("Disconnected");
  await page.keyboard.press("Escape");
  expect(await rowsOf(CAFE.email)).toHaveLength(1);
  expect(await rowsOf(BOUTIQUE.email)).toHaveLength(1);
});

test("switching back and forth needs no password, lands on the Gallery with a toast, and the APIs follow the active login", async () => {
  await page.goto("/competitors");
  await openSwitcher(page);
  await row(page, CAFE.handle).getByRole("button", { name: `Switch to @${CAFE.handle}` }).click();
  await page.waitForURL((url) => url.pathname === "/gallery");
  await expect(page.getByRole("status").filter({ hasText: `Switched to @${CAFE.handle}` })).toBeVisible();
  await expect(page).toHaveURL(/\/gallery$/);
  await expect(switcher(page)).toContainText(`@${CAFE.handle}`);
  expect(await me(page)).toBe(CAFE.email);
  // The other account's data isn't reachable: /api/me and the client view are the cafe's only.
  const meData = (await (await page.request.get("/api/me")).json()).data;
  expect(JSON.stringify(meData)).not.toContain(BOUTIQUE.handle);

  await openSwitcher(page);
  await row(page, BOUTIQUE.handle).getByRole("button", { name: `Switch to @${BOUTIQUE.handle}` }).click();
  await page.waitForURL((url) => url.pathname === "/gallery");
  await expect(page.getByRole("status").filter({ hasText: `Switched to @${BOUTIQUE.handle}` })).toBeVisible();
  expect(await me(page)).toBe(BOUTIQUE.email);
});

test("a tab still showing the previous login can't act for the one switched to", async () => {
  const stale = await device.newPage();
  await stale.goto("/gallery");
  await expect(switcher(stale)).toContainText(`@${BOUTIQUE.handle}`);
  const renderedFor = (await stale.locator('meta[name="lge-account"]').getAttribute("content")) ?? "";
  expect(renderedFor).not.toBe("");
  await page.bringToFront();
  await openSwitcher(page);
  await row(page, CAFE.handle).getByRole("button", { name: `Switch to @${CAFE.handle}` }).click();
  await expect(page.getByRole("status").filter({ hasText: `Switched to @${CAFE.handle}` })).toBeVisible();

  // The stale tab's calls carry the account it was rendered for: refused (and it reloads), so its
  // "Log out of @noorboutique.kw" can't log out the cafe login and /api/me doesn't answer for it.
  const headers = { "x-lge-account": renderedFor };
  const call = async (path: string, method: "GET" | "POST") =>
    (method === "POST" ? await stale.request.post(path, { headers, data: {} }) : await stale.request.get(path, { headers })).status();
  expect(await call("/api/device-accounts/logout", "POST")).toBe(409);
  expect(await call("/api/me", "GET")).toBe(409);
  expect(await me(page)).toBe(CAFE.email);
  await stale.close();

  await openSwitcher(page);
  await row(page, BOUTIQUE.handle).getByRole("button", { name: `Switch to @${BOUTIQUE.handle}` }).click();
  await expect(page.getByRole("status").filter({ hasText: `Switched to @${BOUTIQUE.handle}` })).toBeVisible();
});

test("a login that isn't on this device can't be reached; a tampered or expired one is refused", async ({ browser }) => {
  const cafeLoginId = await loginIdOf(page, CAFE.handle);
  // Unknown id on this device → 404.
  expect((await page.request.post("/api/device-accounts/switch", { data: { loginId: "not-a-login" } })).status()).toBe(404);

  // Another device (its own login) can't use this device's login id, even with a tampered copy of the cookie.
  const { context: other, page: otherPage } = await signedIn(browser, OTHER);
  expect((await otherPage.request.post("/api/device-accounts/switch", { data: { loginId: cafeLoginId } })).status()).toBe(404);
  const sealed = (await device.cookies()).find((c) => c.name === COOKIE)!.value;
  const [v, iv, tag, body] = sealed.split(".");
  const flipped = body.slice(0, -2) + (body.at(-2) === "A" ? "B" : "A") + body.at(-1);
  await other.addCookies([{ name: COOKIE, value: [v, iv, tag, flipped].join("."), url: otherPage.url() }]);
  expect((await otherPage.request.post("/api/device-accounts/switch", { data: { loginId: cafeLoginId } })).status()).toBe(404);
  // The Auth.js endpoint itself refuses it too.
  const csrf = (await (await otherPage.request.get("/api/auth/csrf")).json()).csrfToken as string;
  const direct = await otherPage.request.post("/api/auth/callback/remembered", { form: { loginId: cafeLoginId, csrfToken: csrf }, maxRedirects: 0 });
  expect(direct.headers()["location"] ?? "").toContain("error=CredentialsSignin");
  expect(await me(otherPage)).toBe(OTHER.email);
  // The tampered cookie was dropped: the list only has the other device's own login.
  const otherList = await deviceList(otherPage);
  expect(otherList.items.map((a) => a.handle)).toEqual(["mathanet_baity"]);
  await other.close();

  // Expired: the remembered login stops working, is refused with a friendly message and leaves the list.
  await pool.query(`UPDATE "RememberedLogin" SET "expiresAt" = '2001-01-01' WHERE id = $1`, [cafeLoginId]);
  await page.goto("/gallery");
  await openSwitcher(page);
  await expect(rows(page)).toHaveCount(1);
  await expect(row(page, CAFE.handle)).toHaveCount(0);
  await page.keyboard.press("Escape");
  expect((await page.request.post("/api/device-accounts/switch", { data: { loginId: cafeLoginId } })).status()).toBe(404);
  expect(await rowsOf(CAFE.email)).toHaveLength(0);
  expect(await me(page)).toBe(BOUTIQUE.email);

  // Logging in again with the password adds it back.
  await addByLogin(page, CAFE);
  expect(await rowsOf(CAFE.email)).toHaveLength(1);
});

test("“Create a new account” runs sign-up, Instagram and onboarding; the other logins stay remembered", async () => {
  test.setTimeout(120_000);
  await openSwitcher(page);
  await sheet(page).getByTestId("account-add").click();
  await expect(sheet(page).getByTestId("account-add-login")).toBeVisible();
  await sheet(page).getByTestId("account-add-signup").click();
  await page.waitForURL(/\/signup\?add=1/);
  await expect(page.getByTestId("adding-account")).toBeVisible();
  await page.getByLabel("Email").fill(NEW.email);
  await page.getByLabel("Password").fill(NEW.password);
  await page.getByRole("button", { name: "Continue with Instagram" }).click();
  // The single sign-up page goes straight to Instagram (the demo screen with mock Instagram); no
  // account exists until it connects.
  await page.waitForURL(/\/signup\/demo-instagram/);
  expect((await pool.query(`SELECT 1 FROM "User" WHERE email = $1`, [NEW.email])).rowCount).toBe(0);

  await page.locator("#demo-handle").fill(NEW.handle);
  await page.getByRole("button", { name: "Allow and connect" }).click();
  await page.waitForURL(/\/onboarding/);
  await expect(switcher(page)).toContainText(`@${NEW.handle}`);
  await page.getByRole("button", { name: "Finish later" }).click();
  await page.waitForURL(/\/gallery/);
  await expect(switcher(page)).toContainText(`@${NEW.handle}`);
  newBusinessId = (await pool.query<{ businessId: string }>(`SELECT "businessId" FROM "User" WHERE email = $1`, [NEW.email])).rows[0].businessId;

  await openSwitcher(page);
  await expect(rows(page)).toHaveCount(3);
  await row(page, CAFE.handle).getByRole("button", { name: `Switch to @${CAFE.handle}` }).click();
  await expect(page.getByRole("status").filter({ hasText: `Switched to @${CAFE.handle}` })).toBeVisible();
  expect(await me(page)).toBe(CAFE.email);
});

test("a changed password revokes the remembered login on this device", async ({ browser }) => {
  const { context: elsewhere, page: elsewherePage } = await signedIn(browser, NEW);
  const changed = await elsewherePage.request.patch("/api/me/password", { data: { currentPassword: NEW.password, newPassword: NEW_PASSWORD } });
  expect(changed.ok()).toBe(true);
  // The browser that changed it stays signed in and remembers the login with the new password.
  expect(await me(elsewherePage)).toBe(NEW.email);
  expect((await deviceList(elsewherePage)).items.map((a) => a.handle)).toEqual([NEW.handle]);
  await elsewhere.close();

  const newLoginId = await pool.query<{ id: string }>(`SELECT r.id FROM "RememberedLogin" r JOIN "User" u ON u.id = r."userId" WHERE u.email = $1`, [NEW.email]);
  expect(newLoginId.rows).toHaveLength(1); // only the one remembered by the browser that changed it

  await page.goto("/gallery");
  await switcher(page).click();
  await expect(sheet(page)).toBeVisible();
  // The list was refreshed on opening: the revoked login is gone already.
  await expect(rows(page)).toHaveCount(2);
  await expect(row(page, NEW.handle)).toHaveCount(0);
  await page.keyboard.press("Escape");
  expect(await me(page)).toBe(CAFE.email);
});

test("a revoked login that's still listed is refused with a message when tapped", async () => {
  // Remember the boutique login, then revoke it behind the open list (as another device changing the password would).
  await page.goto("/gallery");
  await openSwitcher(page);
  await expect(row(page, BOUTIQUE.handle)).toBeVisible();
  await pool.query(`UPDATE "User" SET "sessionVersion" = "sessionVersion" + 1 WHERE email = $1`, [BOUTIQUE.email]);
  await row(page, BOUTIQUE.handle).getByRole("button", { name: `Switch to @${BOUTIQUE.handle}` }).click();
  // (The open sheet hides the rest of the page from the accessibility tree, so by text.)
  await expect(page.getByText("That account needs its password again. Log in to add it back.")).toBeVisible();
  await expect(row(page, BOUTIQUE.handle)).toHaveCount(0);
  expect(await me(page)).toBe(CAFE.email);
  await page.keyboard.press("Escape");
  await addByLogin(page, BOUTIQUE);
});

test("an account can be removed from this device", async () => {
  await openSwitcher(page);
  await expect(rows(page)).toHaveCount(2);
  // The active login has no remove button; the other one does.
  await expect(row(page, BOUTIQUE.handle).getByTestId("account-remove")).toHaveCount(0);
  const cafeId = await loginIdOf(page, CAFE.handle);
  await row(page, CAFE.handle).getByTestId("account-remove").click();
  await expect(sheet(page).getByTestId("account-remove-confirm")).toContainText(`Remove @${CAFE.handle} from this device?`);
  await sheet(page).getByTestId("account-remove-yes").click();
  await expect(page.getByText(`@${CAFE.handle} was removed from this device.`)).toBeVisible();
  await expect(rows(page)).toHaveCount(1);
  await page.keyboard.press("Escape");
  expect(await rowsOf(CAFE.email)).toHaveLength(0);
  expect((await page.request.post("/api/device-accounts/switch", { data: { loginId: cafeId } })).status()).toBe(404);
  // The active one can't be removed (it's logged out of instead).
  const activeId = await loginIdOf(page, BOUTIQUE.handle);
  expect((await page.request.delete(`/api/device-accounts/${activeId}`)).status()).toBe(409);
});

test("“Log out of @handle” moves on to another remembered login; “Log out of all accounts” clears them", async () => {
  test.setTimeout(120_000);
  await addByLogin(page, CAFE);
  await openSwitcher(page);
  await expect(rows(page)).toHaveCount(2);
  await expect(sheet(page).getByTestId("account-logout")).toContainText(`Log out of @${CAFE.handle}`);
  await sheet(page).getByTestId("account-logout").click();
  await page.waitForURL((url) => url.pathname === "/gallery");
  await expect(page.getByRole("status").filter({ hasText: `Switched to @${BOUTIQUE.handle}` })).toBeVisible();
  expect(await me(page)).toBe(BOUTIQUE.email);
  expect(await rowsOf(CAFE.email)).toHaveLength(0);
  await openSwitcher(page);
  await expect(rows(page)).toHaveCount(1);
  await page.keyboard.press("Escape");

  // Two again, then everything from the profile menu.
  await addByLogin(page, CAFE);
  await page.getByTestId("profile-menu-trigger").click();
  await expect(page.getByTestId("menu-logout")).toContainText(`Log out of @${CAFE.handle}`);
  await page.getByTestId("menu-logout-all").click();
  await page.waitForURL(/\/login/);
  expect((await device.cookies()).find((c) => c.name === COOKIE)).toBeUndefined();
  expect(await rowsOf(CAFE.email)).toHaveLength(0);
  expect(await rowsOf(BOUTIQUE.email)).toHaveLength(0);
  expect((await page.request.get("/api/device-accounts")).status()).toBe(401);

  // The last login: "Log out of @handle" goes to the login page.
  await page.goto("/login");
  await fillLogin(page, CAFE);
  await page.goto("/gallery");
  await openSwitcher(page);
  await sheet(page).getByTestId("account-logout").click();
  await page.waitForURL(/\/login/);
  expect(await rowsOf(CAFE.email)).toHaveLength(0);
});

test("Arabic on a phone: a right-to-left bottom sheet, no sideways scroll", async ({ browser }) => {
  // The new sign-up (deleted afterwards), so no seeded login's saved language changes.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ar" });
  const p = await context.newPage();
  await p.goto("/login");
  await fillLogin(p, { email: NEW.email, password: NEW_PASSWORD });
  await p.goto("/gallery");
  // The language switch is in the profile menu (and saved for this login).
  await p.getByTestId("profile-menu-trigger").click();
  await p.getByTestId("menu-language").click();
  await expect(p.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(switcher(p)).toHaveAccessibleName(/تبديل الحساب/);
  await openSwitcher(p);
  await expect(sheet(p)).toContainText("الحسابات على هذا الجهاز");
  await expect(sheet(p)).toContainText("إضافة حساب");
  await expect(sheet(p).getByTestId("account-logout")).toContainText("تسجيل الخروج من");
  const box = await sheet(p).boundingBox();
  expect(box && box.y + box.height).toBeGreaterThan(800);
  expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await sheet(p).getByTestId("account-add").click();
  await expect(sheet(p).getByTestId("account-add-login")).toContainText("تسجيل الدخول إلى حساب موجود");
  await expect(sheet(p).getByTestId("account-add-signup")).toContainText("إنشاء حساب جديد");
  await context.close();
});

test("admins: not remembered, and no “Instagram accounts per login” on the System page", async ({ browser }) => {
  const { context, page: p } = await signedIn(browser, ADMIN);
  expect((await context.cookies()).find((c) => c.name === COOKIE)).toBeUndefined();
  expect((await p.request.get("/api/device-accounts")).status()).toBe(403);
  await p.goto("/admin/system");
  await expect(p.getByTestId("plan-limit-starter")).toBeVisible();
  await expect(p.getByTestId("plan-limit-accounts-starter")).toHaveCount(0);
  // The old one-login-several-accounts API is off.
  const { context: user, page: up } = await signedIn(browser, OTHER);
  expect((await up.request.get("/api/accounts")).status()).toBe(404);
  await user.close();
  await context.close();
});
