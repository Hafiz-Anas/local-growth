import { requireRole } from "@/lib/server/guards";
import { handler, ok, readJson, readParams } from "@/lib/server/http";
import { getPermissionsDto, updatePermissions } from "@/lib/server/permissions";
import { updatePermissionsSchema } from "@/lib/validation/api";

type Ctx = RouteContext<"/api/admin/businesses/[id]/permissions">;

/** GET /api/admin/businesses/:id/permissions */
export const GET = handler(async (_request, context: Ctx) => {
  await requireRole("ADMIN");
  const { id } = await readParams(context, "id");
  return ok(await getPermissionsDto(id));
});

/**
 * PATCH /api/admin/businesses/:id/permissions  { changes: { "<featureKey>": boolean, … } }
 * Takes effect on the business's users' next request.
 */
export const PATCH = handler(async (request, context: Ctx) => {
  const session = await requireRole("ADMIN");
  const { id } = await readParams(context, "id");
  const { changes } = await readJson(request, updatePermissionsSchema);
  await getPermissionsDto(id); // 404 for unknown businesses
  return ok(await updatePermissions(id, changes, session.userId));
});
