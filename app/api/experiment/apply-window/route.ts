import { WINDOW_START_HOUR } from "@/config/schedule";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/server/activity";
import { listScheduled } from "@/lib/server/data";
import { requireFeature } from "@/lib/server/guards";
import { ApiError, handler, ok, readJson } from "@/lib/server/http";
import { getInstagramAccount } from "@/lib/server/instagram-account";
import { zonedParts, zonedTimeToUtc } from "@/lib/time";
import { getInstagramService } from "@/lib/services/instagram";
import { applyWindowSchema } from "@/lib/validation/api";

const SPACING_MINUTES = 30;
const DAY = 24 * 60 * 60 * 1000;

/**
 * POST /api/experiment/apply-window  { window? }
 * Moves every upcoming scheduled post into the suggested window (or the one
 * given), on the same local day — the next day if that time has passed. Posts
 * landing on the same day are spaced 30 minutes apart.
 */
export const POST = handler(async (request) => {
  const { businessId, session } = await requireFeature("experiment", "experiment.windows");
  const body = await readJson(request, applyWindowSchema);

  const insights = await getInstagramService().getInsights(await getInstagramAccount(businessId));
  const window = body.window ?? insights.opportunity?.window;
  if (!window) throw new ApiError(409, "conflict", "The experiment has no suggested window yet.");
  const startHour = insights.windows.find((w) => w.id === window)?.startHour ?? WINDOW_START_HOUR[window];

  const { timezone } = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { timezone: true } });
  const posts = await db.scheduledPost.findMany({
    where: { businessId, status: "SCHEDULED", scheduledFor: { gt: new Date() } },
    select: { id: true, scheduledFor: true },
    orderBy: { scheduledFor: "asc" },
  });

  const perDay = new Map<string, number>();
  const moves = posts.map((post) => {
    let day = zonedParts(post.scheduledFor, timezone);
    let target = zonedTimeToUtc({ ...day, hour: startHour, minute: 0 }, timezone);
    if (target.getTime() <= Date.now()) {
      day = zonedParts(new Date(post.scheduledFor.getTime() + DAY), timezone);
      target = zonedTimeToUtc({ ...day, hour: startHour, minute: 0 }, timezone);
    }
    const dayKey = `${day.year}-${day.month}-${day.day}`;
    const slot = perDay.get(dayKey) ?? 0;
    perDay.set(dayKey, slot + 1);
    return { id: post.id, scheduledFor: new Date(target.getTime() + slot * SPACING_MINUTES * 60 * 1000) };
  });

  await db.$transaction(async (tx) => {
    for (const move of moves) await tx.scheduledPost.update({ where: { id: move.id }, data: { scheduledFor: move.scheduledFor } });
    await logActivity({ businessId, userId: session.userId, action: "experiment.window_applied", details: { window, moved: moves.length } }, tx);
  });
  return ok({ window, moved: moves.length, queue: await listScheduled(businessId) });
});
