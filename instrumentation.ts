/**
 * Runs once when the server starts. Warns (without printing any secret) when
 * the Meta integration is selected or half-configured; Meta features then stay
 * off instead of crashing (lib/services/meta/config.ts).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { metaStartupWarning } = await import("./lib/services/meta/config");
  const warning = metaStartupWarning();
  if (warning) console.warn(`\n⚠ ${warning}\n`);
}
