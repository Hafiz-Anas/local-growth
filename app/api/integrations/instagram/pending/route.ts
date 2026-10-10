import { z } from "zod";
import { requireBusiness } from "@/lib/server/guards";
import { ApiError, handler, ok, readJson } from "@/lib/server/http";
import { getConnectionDto } from "@/lib/server/instagram-account";
import { cancelPending, connectPending, getPendingOptions } from "@/lib/server/meta-connect";
import { connectContext } from "@/lib/server/meta-session";

/** GET /api/integrations/instagram/pending — the accounts to pick from after a login that found several (no tokens). */
export const GET = handler(async () => {
  const { businessId } = await requireBusiness();
  const options = await getPendingOptions(businessId);
  if (!options) throw new ApiError(404, "not_found", "This choice has expired. Connect Instagram again.");
  return ok(options);
});

const pickSchema = z.object({ pageId: z.string().min(1).max(64).regex(/^\d+$/) });

/** POST /api/integrations/instagram/pending  { pageId } — connect the picked account. */
export const POST = handler(async (request) => {
  await requireBusiness();
  const ctx = (await connectContext())!;
  const { pageId } = await readJson(request, pickSchema);
  const { outcome, username } = await connectPending(ctx, pageId);
  return ok({ outcome, username: username ?? null, connection: await getConnectionDto(ctx.businessId) });
});

/** DELETE /api/integrations/instagram/pending — the user closed the picker. */
export const DELETE = handler(async () => {
  const { businessId } = await requireBusiness();
  await cancelPending(businessId);
  return ok({ cancelled: true });
});
