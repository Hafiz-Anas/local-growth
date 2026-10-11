/**
 * Vercel build command (`npm run vercel-build`, see DEPLOY.md).
 *
 * 1. prisma generate — the client is gitignored.
 * 2. prisma migrate deploy — only for Production deployments (VERCEL_ENV=production),
 *    over DIRECT_URL (Neon's unpooled connection). It applies pending migrations
 *    and nothing else: never the seed, never `migrate reset` / `migrate dev`.
 *    Preview deployments skip it so a branch can't change the production schema.
 * 3. next build
 *
 * Local `npm run build` is unchanged (plain `next build`).
 */
import { execSync } from "node:child_process";

const run = (command) => execSync(command, { stdio: "inherit" });

run("prisma generate");

if (process.env.VERCEL_ENV === "production") {
  if (!process.env.DIRECT_URL) {
    console.error("DIRECT_URL is not set: Production builds run `prisma migrate deploy`, which needs Neon's direct (non-pooled) connection string.");
    process.exit(1);
  }
  run("prisma migrate deploy");
} else {
  console.log(`Skipping prisma migrate deploy (VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"}).`);
}

run("next build");
