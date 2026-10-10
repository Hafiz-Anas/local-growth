import { db } from "@/lib/db";
import { logActivity } from "@/lib/server/activity";
import { isFeatureEnabled } from "@/lib/permissions";
import { generateCaptions } from "@/lib/server/content";
import { catalogFor } from "@/lib/server/data";
import { DRAFT_SELECT, toDraft } from "@/lib/server/dto";
import { requireFeature } from "@/lib/server/guards";
import { handler, ok, readJson } from "@/lib/server/http";
import { generateDraftsSchema } from "@/lib/validation/api";

/** POST /api/post-drafts/generate  { categoryId, occasionId, language?, count? } — new AI drafts. */
export const POST = handler(async (request) => {
  const { businessId, session, permissions } = await requireFeature("postGenerator");
  const input = await readJson(request, generateDraftsSchema);
  // Custom vocabulary only counts when the business has that feature.
  const vocabulary = isFeatureEnabled(permissions, "postGenerator.brandVocabulary") ? input.vocabulary : [];
  const captions = await generateCaptions(businessId, { ...input, vocabulary, variant: 0 });

  const drafts = await db.$transaction(
    captions.map((c) =>
      db.postDraft.create({
        data: { businessId, category: input.categoryId, angle: input.occasionId, caption: c.caption, language: c.language, createdBy: session.userId },
        select: DRAFT_SELECT,
      }),
    ),
  );
  await logActivity({ businessId, userId: session.userId, action: "drafts.generated", details: { count: drafts.length, category: input.categoryId } });
  const catalog = await catalogFor(businessId);
  return ok(drafts.map((d) => toDraft(d, catalog)), { status: 201 });
});
