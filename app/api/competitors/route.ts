import { db } from "@/lib/db";
import { logActivity } from "@/lib/server/activity";
import { recordCompetitorFetch } from "@/lib/server/competitor-profiles";
import { competitorLimit, competitorLimitError, resolveCompetitorHandle } from "@/lib/server/competitors";
import { getInstagramAccount } from "@/lib/server/instagram-account";
import { listCompetitors } from "@/lib/server/data";
import { COMPETITOR_SELECT, toCompetitor } from "@/lib/server/dto";
import { requireFeature } from "@/lib/server/guards";
import { handler, ok, readJson } from "@/lib/server/http";
import { addCompetitorSchema } from "@/lib/validation/api";

/** GET /api/competitors — tracked competitor accounts. */
export const GET = handler(async () => {
  const { businessId } = await requireFeature("competitors.accounts");
  return ok(await listCompetitors(businessId));
});

/** POST /api/competitors  { handle, displayName?, note? } — start tracking an account. */
export const POST = handler(async (request) => {
  const { businessId, session } = await requireFeature("competitors.accounts");
  const { handle, displayName, note } = await readJson(request, addCompetitorSchema);

  const max = await competitorLimit(businessId);
  if ((await db.competitor.count({ where: { businessId, validationStatus: "READY" } })) >= max) throw competitorLimitError(max);
  const profile = await resolveCompetitorHandle(businessId, handle);

  const competitor = await db.competitor.create({
    data: {
      businessId,
      handle: profile.handle,
      displayName,
      note,
      avatarUrl: profile.avatarUrl,
      followers: profile.followers,
      engagementRate: profile.engagementRate,
      lastFetchedAt: new Date(),
      validationStatus: "READY",
      lastValidatedAt: new Date(),
    },
    select: COMPETITOR_SELECT,
  });
  if ((await getInstagramAccount(businessId)).provider === "meta") await recordCompetitorFetch(competitor.id, profile);
  await logActivity({ businessId, userId: session.userId, action: "competitor.added", details: { handle } });
  return ok(toCompetitor(competitor, profile), { status: 201 });
});
