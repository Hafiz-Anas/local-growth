import { forgetDeviceLogin } from "@/lib/server/device-logins";
import { requireRole } from "@/lib/server/guards";
import { handler, ok, readParams } from "@/lib/server/http";

/** DELETE /api/device-accounts/:id — remove another remembered login from this browser (the active one → 409 `login_active`). */
export const DELETE = handler(async (_request, context: RouteContext<"/api/device-accounts/[id]">) => {
  const session = await requireRole("USER");
  const { id } = await readParams(context, "id");
  await forgetDeviceLogin(session, id);
  return ok({ removed: true });
});
