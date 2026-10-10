import { db } from "@/lib/db";
import { findOwnDraft } from "@/lib/server/content";
import { catalogFor } from "@/lib/server/data";
import { DRAFT_SELECT, toDraft } from "@/lib/server/dto";
import { requireFeature } from "@/lib/server/guards";
import { ApiError, handler, ok, readParams } from "@/lib/server/http";

/** POST /api/post-drafts/:id/reject — discard a draft. */
export const POST = handler(async (_request, context: RouteContext<"/api/post-drafts/[id]/reject">) => {
  const { businessId } = await requireFeature("postGenerator");
  const { id } = await readParams(context, "id");
  const draft = await findOwnDraft(businessId, id);
  if (draft.status !== "DRAFT") throw new ApiError(409, "conflict", "Only unqueued drafts can be rejected.");
  const updated = await db.postDraft.update({ where: { id }, data: { status: "REJECTED" }, select: DRAFT_SELECT });
  return ok(toDraft(updated, await catalogFor(businessId)));
});
