import { db } from "@/lib/db";
import { assertFuture } from "@/lib/server/content";
import { GALLERY_DRAFT_SELECT, toDraftDto } from "@/lib/server/gallery";
import { requireFeature } from "@/lib/server/guards";
import { handler, ok, readJson, readParams } from "@/lib/server/http";
import { approveDraft } from "@/lib/server/publishing";
import { approveDraftSchema } from "@/lib/validation/api";

/** Up to 20 photos are converted and stored for Instagram while the request waits. */
export const maxDuration = 60;

/**
 * POST /api/gallery/drafts/:id/schedule  { scheduledFor, language? } | { now: true, language? } — approves a
 * Gallery / AI chat draft for publishing (lib/server/publishing.ts approveDraft): a job at that time, or now (it
 * starts right after this answer and needs no open browser). Answers the draft with its job. Refusals:
 * 409 instagram_not_connected / already_scheduled, 403 instagram_permission, 422 publish_failed (with the reason).
 */
export const POST = handler(async (request, context: RouteContext<"/api/gallery/drafts/[id]/schedule">) => {
  const { businessId, session } = await requireFeature("gallery.publishing");
  const { id } = await readParams(context, "id");
  const body = await readJson(request, approveDraftSchema);
  const at = "scheduledFor" in body ? body.scheduledFor : null;
  if (at) assertFuture(at);
  await approveDraft(businessId, session.userId, id, { at, language: body.language });
  const draft = await db.postDraft.findUniqueOrThrow({ where: { id }, select: GALLERY_DRAFT_SELECT });
  return ok(toDraftDto(draft), { status: 201 });
});
