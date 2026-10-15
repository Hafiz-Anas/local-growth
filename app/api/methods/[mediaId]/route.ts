import { requireFeature } from "@/lib/server/guards";
import { handler, ok, readJson, readParams } from "@/lib/server/http";
import { setPostMethod } from "@/lib/server/methods";
import { postMethodPatchSchema } from "@/lib/validation/api";

/** PATCH /api/methods/:mediaId  { method?, promoted? } — the client's correction (one tap) or "promoted" flag. */
export const PATCH = handler(async (request, context: RouteContext<"/api/methods/[mediaId]">) => {
  const { businessId } = await requireFeature("methods");
  const { mediaId } = await readParams(context, "mediaId");
  const patch = await readJson(request, postMethodPatchSchema);
  const row = await setPostMethod(businessId, mediaId, patch);
  return ok({ id: row.igMediaId, method: row.method, source: row.source.toLowerCase(), promoted: row.promoted });
});
