import { getAdminIntegration } from "@/lib/server/admin-integration";
import { requireRole } from "@/lib/server/guards";
import { handler, ok, readParams } from "@/lib/server/http";

/** GET /api/admin/businesses/:id/integration — Instagram connection details and the Meta integration log. */
export const GET = handler(async (_request, context: RouteContext<"/api/admin/businesses/[id]/integration">) => {
  await requireRole("ADMIN");
  const { id } = await readParams(context, "id");
  return ok(await getAdminIntegration(id));
});
