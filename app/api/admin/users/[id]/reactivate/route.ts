import { requireRole } from "@/lib/server/guards";
import { handler, ok, readParams } from "@/lib/server/http";
import { setUserStatus } from "@/lib/server/user-status";

/** POST /api/admin/users/:id/reactivate */
export const POST = handler(async (_request, context: RouteContext<"/api/admin/users/[id]/reactivate">) => {
  const session = await requireRole("ADMIN");
  const { id } = await readParams(context, "id");
  return ok(await setUserStatus(id, "ACTIVE", session.userId));
});
