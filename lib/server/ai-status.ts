import "server-only";
import { db } from "@/lib/db";
import { isFeatureEnabled } from "@/lib/permissions";
import { getInstagramService } from "@/lib/services/instagram";
import type { AiStatusDto, Permissions } from "@/types";
import { aiStatusHealth } from "@/lib/ai-status";
import { getInstagramAccount } from "./instagram-account";

/** The AI reads this many recent posts (getMedia limit in gatherAssistantFacts). */
export const AI_POSTS_LIMIT = 20;

/**
 * The dashboard's "AI status" card: which Instagram account the AI features work from, how much
 * they see, how fresh it is and what needs attention. Reads stored data only — no AI or Meta calls.
 */
export async function getAiStatus(businessId: string, permissions: Permissions): Promise<AiStatusDto> {
  const conn = await db.instagramConnection.findUnique({
    where: { businessId },
    select: { provider: true, status: true, username: true, tokenExpiresAt: true, lastSyncAt: true, lastSyncError: true, missingPermissions: true },
  });
  const withCompetitors = isFeatureEnabled(permissions, "competitors");
  const withRecommendations = isFeatureEnabled(permissions, "recommendations");
  const [stored, competitors, analysis] = await Promise.all([
    conn?.provider === "META" ? db.instagramMedia.count({ where: { businessId } }) : null,
    withCompetitors ? db.competitor.count({ where: { businessId, validationStatus: "READY" } }) : null,
    withRecommendations ? db.recommendationRun.findFirst({ where: { businessId, unchanged: false }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }) : null,
  ]);

  const { health, warnings } = aiStatusHealth(conn);

  // Demo data comes from the mock service (no sync); count what it serves.
  let postsAnalyzed: number | null = stored === null ? null : Math.min(stored, AI_POSTS_LIMIT);
  if (health === "demo") {
    const account = await getInstagramAccount(businessId);
    postsAnalyzed = account.connected ? Math.min((await getInstagramService().getMedia(account, { limit: AI_POSTS_LIMIT })).length, AI_POSTS_LIMIT) : null;
  }
  if (health === "disconnected") postsAnalyzed = null;

  const lastSyncAt = conn?.provider === "META" ? (conn.lastSyncAt?.toISOString() ?? null) : null;
  return {
    account: {
      username: conn && conn.status !== "DISCONNECTED" ? conn.username : null,
      health,
      provider: conn && conn.status !== "DISCONNECTED" ? (conn.provider === "META" ? "meta" : "mock") : null,
      missingPermissions: health === "permissions" ? conn!.missingPermissions : [],
    },
    coverage: { postsAnalyzed, postsLimit: AI_POSTS_LIMIT, competitorsTracked: competitors },
    freshness: { lastSyncAt, lastAnalysisAt: analysis?.createdAt.toISOString() ?? null },
    warnings,
  };
}
