import { db } from "@/lib/db";
import { logActivity } from "@/lib/server/activity";
import { competitorProfileFor, recordCompetitorFetch } from "@/lib/server/competitor-profiles";
import { findOwnCompetitor, resolveCompetitorHandle } from "@/lib/server/competitors";
import { COMPETITOR_SELECT, toCompetitor } from "@/lib/server/dto";
import { requireFeature } from "@/lib/server/guards";
import { handler, ok, readJson, readParams } from "@/lib/server/http";
import { getInstagramAccount } from "@/lib/server/instagram-account";
import { updateCompetitorSchema } from "@/lib/validation/api";

type Ctx = RouteContext<"/api/competitors/[id]">;

/** GET /api/competitors/:id — one tracked account with its live profile (detail view). */
export const GET = handler(async (_request, context: Ctx) => {
  const { businessId } = await requireFeature("competitors.accounts");
  const { id } = await readParams(context, "id");
  await findOwnCompetitor(businessId, id);
  const row = await db.competitor.findUniqueOrThrow({ where: { id }, select: COMPETITOR_SELECT });
  const profile = await competitorProfileFor(await getInstagramAccount(businessId), row);
  return ok(toCompetitor(row, profile));
});

/**
 * PATCH /api/competitors/:id  { handle?, displayName?, note? }
 * A changed handle is re-validated (format, own account, duplicates) and looked up again.
 */
export const PATCH = handler(async (request, context: Ctx) => {
  const { businessId, session } = await requireFeature("competitors.accounts");
  const { id } = await readParams(context, "id");
  const current = await findOwnCompetitor(businessId, id);
  const patch = await readJson(request, updateCompetitorSchema);

  const handleChanged = patch.handle !== undefined && patch.handle !== current.handle;
  const profile = handleChanged
    ? await resolveCompetitorHandle(businessId, patch.handle!, id)
    : await competitorProfileFor(await getInstagramAccount(businessId), current);

  if (handleChanged && profile && (await getInstagramAccount(businessId)).provider === "meta") {
    await db.competitor.update({ where: { id }, data: { handle: profile.handle } });
    await db.competitorSnapshot.deleteMany({ where: { competitorId: id } }); // history of the old handle
    await recordCompetitorFetch(id, profile);
  }
  const updated = await db.competitor.update({
    where: { id },
    data: {
      ...(patch.displayName !== undefined && { displayName: patch.displayName }),
      ...(patch.note !== undefined && { note: patch.note }),
      ...(handleChanged &&
        profile && {
          handle: profile.handle,
          avatarUrl: profile.avatarUrl,
          followers: profile.followers,
          engagementRate: profile.engagementRate,
          lastFetchedAt: new Date(),
        }),
    },
    select: COMPETITOR_SELECT,
  });
  await logActivity({
    businessId,
    userId: session.userId,
    action: "competitor.updated",
    details: { handle: updated.handle, ...(handleChanged && { previousHandle: current.handle }) },
  });
  return ok(toCompetitor(updated, profile));
});

/** DELETE /api/competitors/:id — stop tracking. Only the caller's own business's rows match. */
export const DELETE = handler(async (_request, context: Ctx) => {
  const { businessId, session } = await requireFeature("competitors.accounts");
  const { id } = await readParams(context, "id");
  const competitor = await findOwnCompetitor(businessId, id);
  await db.competitor.delete({ where: { id } });
  await logActivity({ businessId, userId: session.userId, action: "competitor.removed", details: { handle: competitor.handle } });
  return ok({ deleted: true });
});
