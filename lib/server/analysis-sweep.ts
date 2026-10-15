import "server-only";
import { db } from "@/lib/db";
import { isFeatureEnabled, permissionsFromRows } from "@/lib/permissions";
import { aiPace } from "./ai-pace";
import { runCompetitorSweep, type CompetitorSweepSummary } from "./competitor-analysis";
import { classifyNewPosts } from "./methods";
import { snapshotPosts } from "./post-performance";

/**
 * The analysis part of the daily cron (GET /api/cron/daily): today's post snapshots (postInsights),
 * method suggestions for new posts (methods, one AI call per business at most), and the weekly
 * competitor refresh + comparison (competitors.analysis). Stops starting new work at the deadline.
 */
export interface AnalysisSweepSummary {
  snapshots: number;
  classified: number;
  competitors: CompetitorSweepSummary | null;
  failed: number;
  stoppedEarly: boolean;
}

export async function runAnalysisSweep(deadlineMs: number): Promise<AnalysisSweepSummary> {
  const started = Date.now();
  const summary: AnalysisSweepSummary = { snapshots: 0, classified: 0, competitors: null, failed: 0, stoppedEarly: false };
  const businesses = await db.business.findMany({
    where: { instagramConnection: { isNot: null }, permissions: { some: { featureKey: { in: ["postInsights", "methods"] }, enabled: true } } },
    select: { id: true, permissions: { select: { featureKey: true, enabled: true } } },
  });
  for (const business of businesses) {
    if (Date.now() - started > deadlineMs / 2) {
      summary.stoppedEarly = true;
      break;
    }
    const permissions = permissionsFromRows(business.permissions);
    try {
      if (isFeatureEnabled(permissions, "postInsights")) summary.snapshots += await snapshotPosts(business.id);
      if (isFeatureEnabled(permissions, "methods")) {
        await aiPace();
        if ((await classifyNewPosts(business.id, permissions)) === "used") summary.classified += 1;
      }
    } catch (error) {
      summary.failed += 1;
      console.error("[analysis] daily sweep failed", business.id, (error as Error).message);
    }
  }
  summary.competitors = await runCompetitorSweep(Math.max(0, deadlineMs - (Date.now() - started)));
  return summary;
}
