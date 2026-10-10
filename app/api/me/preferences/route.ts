import { db } from "@/lib/db";
import { requireAuth } from "@/lib/server/guards";
import { handler, ok, readJson } from "@/lib/server/http";
import { uiPreferencesPatchSchema, uiPreferencesSchema } from "@/lib/validation/api";

/** PATCH /api/me/preferences  { sidebarCollapsed?, theme?, language? } — merged into User.uiPreferences. */
export const PATCH = handler(async (request) => {
  const session = await requireAuth();
  const patch = await readJson(request, uiPreferencesPatchSchema);
  const user = await db.user.findUniqueOrThrow({ where: { id: session.userId }, select: { uiPreferences: true } });
  const current = uiPreferencesSchema.catch(uiPreferencesSchema.parse({})).parse(user.uiPreferences ?? {});
  const uiPreferences = { ...current, ...patch };
  await db.user.update({ where: { id: session.userId }, data: { uiPreferences } });
  return ok({ uiPreferences });
});
