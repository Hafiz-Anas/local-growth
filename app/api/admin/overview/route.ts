import { db } from "@/lib/db";
import { connectionStatusOf } from "@/lib/server/instagram-account";
import { requireRole } from "@/lib/server/guards";
import { handler, ok } from "@/lib/server/http";
import type { AdminOverviewDto, ConnectionStatus, PlanId } from "@/types";

const WEEK = 7 * 24 * 60 * 60 * 1000;

/** GET /api/admin/overview — platform-wide stats across all businesses. */
export const GET = handler(async () => {
  await requireRole("ADMIN");
  const weekAgo = new Date(Date.now() - WEEK);

  const [plans, users, businesses, publishedThisWeek, scheduled, awaiting, handled] = await Promise.all([
    db.business.groupBy({ by: ["plan"], _count: { _all: true } }),
    db.user.groupBy({ by: ["role", "status"], _count: { _all: true } }),
    db.business.findMany({ select: { instagramConnection: { select: { status: true, tokenExpiresAt: true } } } }),
    db.scheduledPost.count({ where: { status: "PUBLISHED", scheduledFor: { gte: weekAgo } } }),
    db.scheduledPost.count({ where: { status: "SCHEDULED", scheduledFor: { gt: new Date() } } }),
    db.replyDraft.count({ where: { status: "PENDING" } }),
    db.replyDraft.count({ where: { status: { in: ["POSTED", "DISMISSED"] }, createdAt: { gte: weekAgo } } }),
  ]);

  const byPlan: Record<PlanId, number> = { starter: 0, growth: 0, pro: 0 };
  for (const row of plans) byPlan[row.plan.toLowerCase() as PlanId] = row._count._all;

  const count = (filter: (r: (typeof users)[number]) => boolean) => users.filter(filter).reduce((sum, r) => sum + r._count._all, 0);

  const connections: Record<ConnectionStatus, number> = { connected: 0, needs_attention: 0, disconnected: 0 };
  for (const b of businesses) connections[connectionStatusOf(b.instagramConnection)] += 1;

  const overview: AdminOverviewDto = {
    businesses: { total: businesses.length, byPlan },
    users: {
      total: count(() => true),
      admins: count((r) => r.role === "ADMIN"),
      active: count((r) => r.status === "ACTIVE"),
      suspended: count((r) => r.status === "SUSPENDED"),
    },
    connections,
    postsPublishedThisWeek: publishedThisWeek,
    postsScheduled: scheduled,
    repliesAwaitingApproval: awaiting,
    commentsHandledThisWeek: handled,
  };
  return ok(overview);
});
