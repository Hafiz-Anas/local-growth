import { db } from "@/lib/db";
import { findOwnDraft } from "@/lib/server/content";
import { catalogFor } from "@/lib/server/data";
import { DRAFT_SELECT, toDraft } from "@/lib/server/dto";
import { requireFeature } from "@/lib/server/guards";
import { ApiError, handler, ok, readJson, readParams } from "@/lib/server/http";
import { editDraftSchema } from "@/lib/validation/api";

/** PATCH /api/post-drafts/:id  { caption } — edit a draft or queued post's caption. */
export const PATCH = handler(async (request, context: RouteContext<"/api/post-drafts/[id]">) => {
  const { businessId } = await requireFeature("postGenerator");
  const { id } = await readParams(context, "id");
  const draft = await findOwnDraft(businessId, id);
  if (draft.status !== "DRAFT" && draft.status !== "QUEUED") throw new ApiError(409, "conflict", "Published or rejected drafts can't be edited.");
  const { caption } = await readJson(request, editDraftSchema);
  const updated = await db.postDraft.update({ where: { id }, data: { caption }, select: DRAFT_SELECT });
  return ok(toDraft(updated, await catalogFor(businessId)));
});
