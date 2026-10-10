import { getAdminBusiness } from "@/lib/server/admin";
import { requireRole } from "@/lib/server/guards";
import { handler, ok, readParams } from "@/lib/server/http";
import { inviteToOnboarding } from "@/lib/server/onboarding";
import { appBaseUrl } from "@/lib/server/password-reset";

/**
 * POST /api/admin/businesses/:id/onboarding-invite — "Send onboarding invite":
 * the client's users are taken through the wizard on their next visit, and
 * each gets an email with a login link.
 */
export const POST = handler(async (request, context: RouteContext<"/api/admin/businesses/[id]/onboarding-invite">) => {
  const session = await requireRole("ADMIN");
  const { id } = await readParams(context, "id");
  const { recipients } = await inviteToOnboarding(id, session.userId, appBaseUrl(request));
  return ok({ recipients, business: await getAdminBusiness(id) });
});
