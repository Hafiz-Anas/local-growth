/**
 * Helpers for CLI scripts that write to the database: show which database a
 * script is about to touch (never the credentials) and recognise hosted ones.
 */

/** "host/database" from a PostgreSQL URL, without user or password. */
export function describeDatabase(url: string | undefined): string {
  if (!url) return "(DATABASE_URL is not set)";
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}${parsed.pathname}`;
  } catch {
    return "(DATABASE_URL is not a valid URL)";
  }
}

/** True for Neon, or when running on Vercel / with NODE_ENV=production. */
export function isProductionTarget(url: string | undefined): boolean {
  if (process.env.VERCEL || process.env.NODE_ENV === "production") return true;
  try {
    return url ? new URL(url).hostname.endsWith(".neon.tech") : false;
  } catch {
    return false;
  }
}
