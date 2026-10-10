import { requireRole } from "@/lib/server/guards";
import { handler, ok, readJson, readParams } from "@/lib/server/http";
import { applyPlanPreset, getPermissionsDto } from "@/lib/server/permissions";
import { applyPresetSchema } from "@/lib/validation/api";

/** POST /api/admin/businesses/:id/permissions/preset  { plan, setPlan? } — replace all permissions with a plan preset. */
export const POST = handler(async (request, context: RouteContext<"/api/admin/businesses/[id]/permissions/preset">) => {
  const session = await requireRole("ADMIN");
  const { id } = await readParams(context, "id");
  const { plan, setPlan } = await readJson(request, applyPresetSchema);
  await getPermissionsDto(id); // 404 for unknown businesses
  return ok(await applyPlanPreset(id, plan, setPlan, session.userId));
});
