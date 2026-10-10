import { randomInt } from "node:crypto";
import { db } from "@/lib/db";
import { findOwnDraft, generateCaptions } from "@/lib/server/content";
import { catalogFor } from "@/lib/server/data";
import { DRAFT_SELECT, toDraft } from "@/lib/server/dto";
import { requireFeature } from "@/lib/server/guards";
import { ApiError, handler, ok, readParams } from "@/lib/server/http";

/** POST /api/post-drafts/:id/regenerate — replace the draft's caption with a new AI version. */
export const POST = handler(async (_request, context: RouteContext<"/api/post-drafts/[id]/regenerate">) => {
  const { businessId } = await requireFeature("postGenerator.regenerate");
  const { id } = await readParams(context, "id");
  const draft = await findOwnDraft(businessId, id);
  if (draft.status !== "DRAFT") throw new ApiError(409, "conflict", "Only unqueued drafts can be regenerated.");

  const [caption] = await generateCaptions(businessId, {
    categoryId: draft.category,
    occasionId: draft.angle,
    language: draft.language === "en" ? "en" : "ar",
    count: 1,
    variant: randomInt(1, 1000),
  });
  const updated = await db.postDraft.update({ where: { id }, data: { caption: caption.caption, language: caption.language }, select: DRAFT_SELECT });
  return ok(toDraft(updated, await catalogFor(businessId)));
});
