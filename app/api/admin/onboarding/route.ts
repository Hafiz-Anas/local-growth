import { requireRole } from "@/lib/server/guards";
import { handler, ok } from "@/lib/server/http";
import { getAdminOnboarding } from "@/lib/server/onboarding";

/** GET /api/admin/onboarding — self sign-ups (and invited clients): progress, time per step, errors, feedback, funnel. */
export const GET = handler(async () => {
  await requireRole("ADMIN");
  return ok(await getAdminOnboarding());
});
