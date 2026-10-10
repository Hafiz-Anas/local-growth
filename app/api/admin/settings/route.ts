import { logActivity } from "@/lib/server/activity";
import { requireRole } from "@/lib/server/guards";
import { handler, ok, readJson } from "@/lib/server/http";
import { getAdminSettings, getRequireInstagramConnection, getSelfSignupPlan, setRequireInstagramConnection, setSelfSignupPlan } from "@/lib/server/settings";
import { adminSettingsPatchSchema } from "@/lib/validation/api";

/** GET /api/admin/settings — platform settings (default plan for self sign-ups). */
export const GET = handler(async () => {
  await requireRole("ADMIN");
  return ok(await getAdminSettings());
});

/** PATCH /api/admin/settings  { selfSignupPlan?, requireInstagramConnection? } — plan applies to new sign-ups only. */
export const PATCH = handler(async (request) => {
  const session = await requireRole("ADMIN");
  const { selfSignupPlan, requireInstagramConnection } = await readJson(request, adminSettingsPatchSchema);
  if (requireInstagramConnection !== undefined) {
    const before = await getRequireInstagramConnection();
    await setRequireInstagramConnection(requireInstagramConnection);
    if (before !== requireInstagramConnection) {
      await logActivity({ userId: session.userId, action: "settings.require_instagram_changed", details: { from: before, to: requireInstagramConnection } });
    }
  }
  if (selfSignupPlan) {
    const before = await getSelfSignupPlan();
    await setSelfSignupPlan(selfSignupPlan);
    if (before !== selfSignupPlan) {
      await logActivity({ userId: session.userId, action: "settings.self_signup_plan_changed", details: { from: before, to: selfSignupPlan } });
    }
  }
  return ok(await getAdminSettings());
});
