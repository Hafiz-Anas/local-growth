import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { LOGIN_HAS_SEVERAL_ACCOUNTS } from "../../config/accounts";

/**
 * Instagram account switching (see playwright.config.ts for how to run): one login, several
 * Instagram accounts. Uses the seeded "Noor Boutique" login (Starter, no other spec uses it):
 * at the plan's limit (1) the switcher shows a note; the admin raises the limit on the System
 * page; "Add account" runs the onboarding for the new account only (the same Instagram can't be
 * added twice); every API stays scoped to the active account — ids of the other account, another
 * client's account and a stale tab all fail; switching back lands on the Gallery; Arabic on a phone;
 * the admin sees both accounts against the limit. Afterwards the added account is deleted (the
 * login keeps its first one) and the limit is set back to 1.
 */

const USER = { email: "boutique@localgrowth.dev", password: "User@123" };
const ADMIN = { email: "admin@localgrowth.dev", password: "Admin@123" };
const FIRST = { id: "cl_boutique", handle: "noorboutique.kw" };
const OTHER_CLIENT = "cl_cafe";
const RUN = Date.now().toString(36).slice(-6);
const SECOND_HANDLE = `noorsecond${RUN}`;

test.describe.configure({ mode: "serial" });
// Off while one login = one Instagram account (config/accounts.ts); tests/e2e/device-accounts.spec.ts covers switching.
test.skip(!LOGIN_HAS_SEVERAL_ACCOUNTS, "Several Instagram accounts per login is turned off.");

let admin: BrowserContext;
let user: BrowserContext;
let page: Page;
let secondId: string | null = null;
let firstDraftId: string;

async function login(p: Page, who: { email: string; password: string }) {
  await p.goto("/login");
  await p.getByLabel("Email").fill(who.email);
  await p.getByLabel("Password", { exact: true }).fill(who.password);
  await p.getByRole("button", { name: "Log in" }).click();
  await p.waitForURL((url) => !url.pathname.startsWith("/login"));
}

async function signedIn(browser: Browser, who: { email: string; password: string }) {
  const context = await browser.newContext();
  const p = await context.newPage();
  await login(p, who);
  return { context, page: p };
}

const setAccountLimit = (limit: number) =>
  admin.request.patch("/api/admin/settings", { data: { planLimits: { starter: { instagramAccounts: limit } } } });

const switcher = (p: Page) => p.getByTestId("account-switcher");
const openSwitcher = async (p: Page) => {
  await switcher(p).click();
  await expect(p.getByTestId("account-switcher-menu")).toBeVisible();
  await expect(p.getByTestId("account-row").first()).toBeVisible();
};

test.beforeAll(async ({ browser }) => {
  ({ context: admin } = await signedIn(browser, ADMIN));
  expect((await setAccountLimit(1)).ok()).toBe(true);
  ({ context: user, page } = await signedIn(browser, USER));
});

test.afterAll(async () => {
  // The login keeps its first account; the one added here goes, and the default limit comes back.
  if (secondId) await admin.request.delete(`/api/admin/businesses/${secondId}`);
  await setAccountLimit(1);
  await user?.close();
  await admin?.close();
});

test("the switcher shows the active Instagram account; at the plan's limit a note replaces “Add account”", async () => {
  await page.goto("/gallery");
  await expect(switcher(page)).toContainText(`@${FIRST.handle}`);
  // Separate from the profile menu.
  await expect(page.getByTestId("profile-menu-trigger")).toBeVisible();

  await openSwitcher(page);
  const rows = page.getByTestId("account-row");
  await expect(rows).toHaveCount(1);
  // The seeded boutique account is disconnected; the row says so.
  await expect(rows.first()).toContainText("Disconnected");
  await expect(page.getByTestId("account-add")).toHaveCount(0);
  await expect(page.getByTestId("account-limit")).toHaveText("Your plan includes 1 Instagram account. Contact us to add more.");
  await page.keyboard.press("Escape");

  // Over the limit the API refuses too.
  const res = await page.request.post("/api/accounts");
  expect(res.status()).toBe(409);
  expect((await res.json()).error.code).toBe("account_limit");

  const drafts = (await (await page.request.get("/api/post-drafts")).json()).data;
  firstDraftId = (Array.isArray(drafts) ? drafts : drafts.items)[0].id;
  expect(firstDraftId).toBeTruthy();
});

test("the admin sets the Instagram accounts per plan on the System page", async () => {
  const p = await admin.newPage();
  await p.goto("/admin/system");
  const field = p.getByTestId("plan-limit-accounts-starter");
  await expect(field).toHaveValue("1");
  const saved = p.waitForResponse((r) => r.url().endsWith("/api/admin/settings") && r.request().method() === "PATCH");
  await field.fill("2");
  await field.blur();
  expect((await saved).ok()).toBe(true);
  await p.reload();
  await expect(p.getByTestId("plan-limit-accounts-starter")).toHaveValue("2");
  await p.close();
});

test("“Add account” sets up only the new account; the same Instagram can't be added twice; Finish later lands on its Gallery", async () => {
  await page.goto("/gallery");
  await openSwitcher(page);
  await page.getByTestId("account-add").click();
  // The new account connects Instagram first (sign-up's connect screen), then gets the wizard.
  await page.waitForURL("**/signup/instagram");

  // The connect screen shows the switcher (a way back to the other account).
  await expect(switcher(page)).toContainText("New Instagram account");

  await page.locator("#ob-handle").fill(FIRST.handle);
  await page.getByRole("button", { name: "Connect Instagram", exact: true }).click();
  await expect(page.getByText("This Instagram account is already one of yours.")).toBeVisible();

  await page.locator("#ob-handle").fill(SECOND_HANDLE);
  await page.getByRole("button", { name: "Connect Instagram", exact: true }).click();
  await page.waitForURL("**/onboarding");
  await expect(switcher(page)).toBeVisible();

  await page.getByRole("button", { name: "Finish later" }).click();
  await page.waitForURL("**/gallery");
  await expect(switcher(page)).toContainText(`@${SECOND_HANDLE}`);

  const accounts = (await (await page.request.get("/api/accounts")).json()).data;
  expect(accounts.items.map((a: { id: string }) => a.id)).toContain(FIRST.id);
  secondId = accounts.items.find((a: { active: boolean }) => a.active).id;
  expect(secondId).not.toBe(FIRST.id);
  expect(accounts).toMatchObject({ count: 2, limit: 2, canAdd: false });
});

test("everything is scoped to the active account: other accounts' ids, other clients and stale tabs fail", async () => {
  // The first account's post drafts aren't visible or changeable from the second.
  const list = (await (await page.request.get("/api/post-drafts")).json()).data;
  expect(JSON.stringify(list)).not.toContain(firstDraftId);
  expect((await page.request.patch(`/api/post-drafts/${firstDraftId}`, { data: { caption: "Not yours" } })).status()).toBe(404);
  expect((await page.request.delete(`/api/post-drafts/${firstDraftId}/image`)).status()).toBe(404);

  // Switching to another client's account (or a made-up one) is 404, and nothing changes.
  for (const accountId of [OTHER_CLIENT, "cl_does_not_exist"]) {
    const res = await page.request.post("/api/accounts/switch", { data: { accountId } });
    expect(res.status()).toBe(404);
  }
  const accounts = (await (await page.request.get("/api/accounts")).json()).data;
  expect(accounts.items.find((a: { active: boolean }) => a.active).id).toBe(secondId);
  expect(accounts.items.map((a: { id: string }) => a.id)).not.toContain(OTHER_CLIENT);

  // A screen rendered for the other account can't act on this one.
  const stale = await page.request.get("/api/post-drafts", { headers: { "x-lge-account": FIRST.id } });
  expect(stale.status()).toBe(409);
  expect((await stale.json()).error.code).toBe("account_switched");
});

test("switching is instant, keeps the login, lands on the Gallery, and a stale tab reloads into the active account", async () => {
  const staleTab = await user.newPage();
  await staleTab.goto("/gallery");
  await expect(switcher(staleTab)).toContainText(`@${SECOND_HANDLE}`);

  await page.goto("/post-performance");
  await openSwitcher(page);
  await expect(page.getByTestId("account-row")).toHaveCount(2);
  await expect(page.getByTestId("account-limit")).toHaveText("Your plan includes 2 Instagram accounts and they're all in use. Contact us to add more.");
  await page.locator(`[data-testid="account-row"][data-account-id="${FIRST.id}"]`).click();
  await page.waitForURL("**/gallery");
  await expect(switcher(page)).toContainText(`@${FIRST.handle}`);

  // Same person: the profile menu still shows the login's name and email.
  await page.getByTestId("profile-menu-trigger").click();
  await expect(page.getByRole("menu")).toContainText(USER.email);
  await page.keyboard.press("Escape");

  // The first account's draft is back, untouched.
  const drafts = JSON.stringify((await (await page.request.get("/api/post-drafts")).json()).data);
  expect(drafts).toContain(firstDraftId);
  expect(drafts).not.toContain("Not yours");

  // The other tab still shows the second account; its next call reloads it into the first.
  await openSwitcher(staleTab).catch(() => undefined);
  await staleTab.waitForURL("**/gallery");
  await expect(switcher(staleTab)).toContainText(`@${FIRST.handle}`);
  await staleTab.close();
});

test("Arabic on a phone: right-to-left, no sideways scroll", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await context.newPage();
  await login(p, USER);
  await p.goto("/gallery");
  const toggleLanguage = async () => {
    await p.getByTestId("profile-menu-trigger").click();
    await p.getByTestId("menu-language").click();
  };
  const wasRtl = (await p.locator("html").getAttribute("dir")) === "rtl";
  if (!wasRtl) await toggleLanguage();
  await expect(p.locator("html")).toHaveAttribute("dir", "rtl");

  await expect(switcher(p)).toBeVisible();
  await openSwitcher(p);
  await expect(p.getByTestId("account-switcher-menu")).toContainText("حسابات إنستغرام الخاصة بك");
  await expect(p.getByTestId("account-row")).toHaveCount(2);
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await p.keyboard.press("Escape");

  if (!wasRtl) await toggleLanguage();
  await context.close();
});

test("the admin sees the client's Instagram accounts, their connection and the count against the plan", async () => {
  const p = await admin.newPage();
  await p.goto(`/admin/clients/${FIRST.id}`);
  const card = p.getByTestId("admin-instagram-accounts");
  await expect(card.getByTestId("admin-account-row")).toHaveCount(2);
  await expect(card).toContainText(`@${FIRST.handle}`);
  await expect(card).toContainText(`@${SECOND_HANDLE}`);
  await expect(card).toContainText("Disconnected");
  await expect(card).toContainText("Connected");
  await expect(card.getByTestId("admin-accounts-count")).toHaveText("2 of 2 on the plan");
  await p.close();
});
