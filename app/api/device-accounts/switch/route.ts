import { z } from "zod";
import { switchDeviceLogin } from "@/lib/server/device-logins";
import { requireRole } from "@/lib/server/guards";
import { handler, ok, readJson } from "@/lib/server/http";

const switchSchema = z.object({ loginId: z.string().min(1).max(64) }).strict();

/**
 * POST /api/device-accounts/switch  { loginId } — sign this browser in as another login remembered on it.
 * Not remembered here → 404; no longer valid (password changed, logged out, suspended, expired) → 409
 * `login_expired` and it's forgotten. Answers where to go; the browser loads it fresh.
 */
export const POST = handler(async (request) => {
  const session = await requireRole("USER");
  const { loginId } = await readJson(request, switchSchema);
  return ok(await switchDeviceLogin(session, loginId));
});
