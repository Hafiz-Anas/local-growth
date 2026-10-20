import { listDeviceAccounts } from "@/lib/server/device-logins";
import { requireRole } from "@/lib/server/guards";
import { handler, ok } from "@/lib/server/http";

/** GET /api/device-accounts — the logins remembered on this browser (account switcher), the signed-in one marked active. */
export const GET = handler(async () => {
  const session = await requireRole("USER");
  return ok(await listDeviceAccounts(session));
});
