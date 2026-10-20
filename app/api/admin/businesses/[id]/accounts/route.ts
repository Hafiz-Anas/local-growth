import { LOGIN_HAS_SEVERAL_ACCOUNTS } from "@/config/accounts";
import { db } from "@/lib/db";
import { adminAccountsFor } from "@/lib/server/accounts";
import { requireRole } from "@/lib/server/guards";
import { handler, notFound, ok, readParams } from "@/lib/server/http";

/** GET /api/admin/businesses/:id/accounts — every Instagram account this client's logins can switch between, with the plan limit. */
export const GET = handler(async (_request, context: RouteContext<"/api/admin/businesses/[id]/accounts">) => {
  await requireRole("ADMIN");
  if (!LOGIN_HAS_SEVERAL_ACCOUNTS) throw notFound();
  const { id } = await readParams(context, "id");
  if (!(await db.business.count({ where: { id } }))) throw notFound("Business");
  return ok(await adminAccountsFor(id));
});
