import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests (tests/e2e, `npm run test:e2e`). Playwright starts the app itself (`webServer`
 * below) with a fixed e2e environment, against a throwaway database with the demo seed — never
 * your real one:
 *
 *   DATABASE_URL=…/lge_e2e  npx prisma migrate deploy && npx prisma db seed
 *   DATABASE_URL=…/lge_e2e  npm run test:e2e
 *
 * The e2e server always runs with EMAIL_PROVIDER=console (and RESEND_API_BASE on a closed local
 * port), mock Instagram, local storage and Gemini pointed at the local stub — these win over
 * .env / .env.local, so tests never send real email or call Meta or Google. It never reuses a
 * server it didn't start: if the port (E2E_PORT, default 3001) is taken, the run stops.
 *
 * The assistant, recommendations and reports-notifications specs start a Gemini stub (tests/e2e/gemini-stub.ts)
 * on port 4010 (E2E_GEMINI_STUB_PORT), so Google is never called. Run the suite on a fresh seed: specs run in
 * file order, and reports-notifications (the daily cron) must come after recommendations.
 * The tests change data (rules, permissions, chats, recommendations) and refuse any non-local database.
 * E2E_BROWSER_CHANNEL=chrome uses the installed Chrome instead of Playwright's Chromium;
 * E2E_SERVER_STDOUT=1 prints the server's log (e.g. the `[email:console]` lines).
 * Run it from the correctly-cased project path (see CLAUDE.md): Next starts in this directory.
 *
 * E2E_AI_PROVIDER=mock starts the app with the mock AI instead (no Gemini at all) for the specs that test
 * demo mode. Run only those specs then (the others expect the Gemini stub):
 *   E2E_AI_PROVIDER=mock npx playwright test recommendations-mock
 */
const port = Number(process.env.E2E_PORT ?? 3001);
const baseURL = `http://localhost:${port}`;

// Specs also read DATABASE_URL to reach the e2e database directly. Local throwaway databases only.
const databaseUrl = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(databaseUrl) || !/\/[^/?]*(e2e|test)[^/?]*(\?|$)/i.test(databaseUrl)) {
  throw new Error("Set DATABASE_URL to a local e2e database (its name must contain “e2e” or “test”, e.g. …/lge_e2e).");
}

// The specs default to the same secret and stub port.
const cronSecret = process.env.CRON_SECRET ?? "e2e-cron";
const geminiStubPort = process.env.E2E_GEMINI_STUB_PORT ?? "4010";
const aiProvider = process.env.E2E_AI_PROVIDER === "mock" ? "mock" : "gemini";

/** The e2e server's environment. Next never overrides variables that are already set with .env values. */
const E2E_SERVER_ENV: Record<string, string> = {
  DATABASE_URL: databaseUrl,
  // Email: printed to the server log only. Even a misconfigured provider can't reach Resend.
  EMAIL_PROVIDER: "console",
  RESEND_API_BASE: "http://127.0.0.1:9",
  INSTAGRAM_PROVIDER: "mock",
  STORAGE_PROVIDER: "local",
  META_APP_SECRET: "e2e-secret",
  CRON_SECRET: cronSecret,
  AI_PROVIDER: aiProvider,
  GEMINI_API_KEY: "e2e-not-a-real-key",
  GEMINI_API_BASE: `http://127.0.0.1:${geminiStubPort}/v1beta`,
};

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  webServer: {
    command: `npx next dev -p ${port}`,
    url: `${baseURL}/login`,
    env: E2E_SERVER_ENV,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: process.env.E2E_SERVER_STDOUT === "1" ? "pipe" : "ignore",
    stderr: "pipe",
  },
  use: {
    baseURL,
    channel: process.env.E2E_BROWSER_CHANNEL || undefined,
    locale: "en-US",
    trace: "retain-on-failure",
  },
});
