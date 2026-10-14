import { buildBrandContext, currentBrandContext, updateBrandContext } from "@/lib/server/brand";
import { requireBusiness } from "@/lib/server/guards";
import { handler, notFound, ok, readJson } from "@/lib/server/http";
import { brandContextPatchSchema } from "@/lib/validation/api";

/** GET /api/brand/context — the current (newest ready) brand context. */
export const GET = handler(async () => {
  const { businessId } = await requireBusiness();
  const context = await currentBrandContext(businessId);
  if (!context) throw notFound("Brand profile");
  return ok(context);
});

/**
 * POST /api/brand/context — build a new version with AIService.buildBrandContext ("Rebuild" in
 * Settings → Brand profile; onboarding builds the first one in the background when it finishes).
 * Older versions are kept.
 */
export const POST = handler(async () => {
  const { businessId, session } = await requireBusiness();
  return ok(await buildBrandContext(businessId, session.userId), { status: 201 });
});

/** PATCH /api/brand/context — edit the current version (summary, styles, purpose cards, colours, tone, words). */
export const PATCH = handler(async (request) => {
  const { businessId, session } = await requireBusiness();
  const patch = await readJson(request, brandContextPatchSchema);
  return ok(await updateBrandContext(businessId, patch, session.userId));
});
