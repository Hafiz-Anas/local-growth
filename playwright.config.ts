import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests (tests/e2e, `npm run test:e2e`). They drive a RUNNING app with the demo
 * seed — start it against a throwaway database first, never your real one:
 *
 *   DATABASE_URL=…/lge_e2e  npx prisma migrate deploy && npx prisma db seed
 *   DATABASE_URL=…/lge_e2e INSTAGRAM_PROVIDER=mock STORAGE_PROVIDER=local META_APP_SECRET=e2e-secret \
 *     AI_PROVIDER=gemini GEMINI_API_KEY=e2e-not-a-real-key GEMINI_API_BASE=http://127.0.0.1:4010/v1beta npx next dev -p 3001
 *   DATABASE_URL=…/lge_e2e META_APP_SECRET=e2e-secret E2E_BASE_URL=http://localhost:3001 npm run test:e2e
 *
 * The assistant spec starts its own Gemini stub on port 4010 (E2E_GEMINI_STUB_PORT), so Google is never called.
 * The tests change data (rules, permissions, chats) and refuse any non-local URL.
 * E2E_BROWSER_CHANNEL=chrome uses the installed Chrome instead of Playwright's Chromium.
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(baseURL)) throw new Error(`E2E tests only run against a local app (got ${baseURL}).`);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    channel: process.env.E2E_BROWSER_CHANNEL || undefined,
    locale: "en-US",
    trace: "retain-on-failure",
  },
});
