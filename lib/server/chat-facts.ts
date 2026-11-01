import "server-only";
import { db } from "@/lib/db";
import { isFeatureEnabled } from "@/lib/permissions";
import { chatFactsBlock, wantsTopic, type ChatTopic } from "@/lib/services/text/ai-chat";
import { formatFacts } from "@/lib/services/text/assistant";
import { outcomeSummary, type OutcomeResult } from "@/lib/services/text/strategy";
import type { Permissions } from "@/types";
import { gatherAnalysis, gatherAssistantFacts } from "./assistant";
import { GALLERY_DRAFT_WHERE } from "./gallery";
import { shareabilityFacts } from "./shareability";

/**
 * The business facts sent with an AI tab question (AI3): the shared data block (gatherAssistantFacts —
 * onboarding answers, Settings, brand voice, Instagram results, posting times, analysis pages) plus the
 * sections only the chat uses — this week's Recommendations tips and last week's results, the Gallery and
 * drafts — and what the data can't tell yet. Each part is loaded only when its feature is on and the question
 * is about it (`topics`, chatTopics()); the block is cut to CHAT_FACTS_MAX (lib/services/text/ai-chat.ts).
 * Never calls the AI; reads stored data only (Meta accounts: the synced copy).
 */
export async function chatFacts(businessId: string, permissions: Permissions, topics: Set<ChatTopic> | "all", now = new Date()): Promise<string> {
  const on = (key: Parameters<typeof isFeatureEnabled>[1]) => isFeatureEnabled(permissions, key);
  const competitors = on("competitors") && wantsTopic(topics, "competitors");
  const results = wantsTopic(topics, "results") || wantsTopic(topics, "post");
  const tips = on("recommendations") && (wantsTopic(topics, "tips") || wantsTopic(topics, "results"));
  const gallery = on("gallery") && (wantsTopic(topics, "gallery") || wantsTopic(topics, "post"));

  // The analysis pages' numbers only for results questions; the base block always has the headline numbers.
  const facts = await gatherAssistantFacts(businessId, "chat", { withCompetitors: competitors, permissions: results ? permissions : undefined });
  const connected = facts.instagram.status !== "not_connected";
  const [competitorAnalysis, shares, recommendations, galleryLines] = await Promise.all([
    competitors && connected && on("competitors.analysis") ? gatherAnalysis(businessId, "competitors", permissions) : undefined,
    results && connected && on("postInsights.shareability") ? shareabilityFacts(businessId).catch(() => []) : [],
    tips ? recommendationLines(businessId, now) : null,
    gallery ? galleryFacts(businessId) : null,
  ]);
  if (competitorAnalysis?.competitors) facts.analysis = { ...facts.analysis, competitors: competitorAnalysis.competitors, you: facts.analysis?.you ?? competitorAnalysis.you, followers: facts.analysis?.followers ?? competitorAnalysis.followers };
  if (shares.length) facts.shareability = shares;

  return chatFactsBlock(formatFacts(facts, "chat", now), facts, {
    recommendations: recommendations?.lines,
    gallery: galleryLines,
    competitorsLoaded: competitors,
    tips: recommendations ? recommendations.current : null,
  });
}

const day = (d: Date) => d.toISOString().slice(0, 10);

/** This week's tips (from the latest analysis) and the results of tips marked Done in the last 30 days. */
async function recommendationLines(businessId: string, now: Date): Promise<{ lines: string[]; current: number }> {
  const run = await db.recommendationRun.findFirst({ where: { businessId, unchanged: false }, orderBy: { createdAt: "desc" }, select: { id: true, createdAt: true } });
  const [current, done] = await Promise.all([
    run ? db.recommendation.findMany({ where: { runId: run.id, status: { in: ["NEW", "ACCEPTED"] } }, orderBy: [{ rank: "asc" }, { createdAt: "asc" }], take: 3, select: { actionEn: true, rationaleEn: true, impact: true, basedOnPosts: true } }) : [],
    db.recommendation.findMany({
      where: { businessId, status: "DONE", statusAt: { gte: new Date(now.getTime() - 30 * 86_400_000) } },
      orderBy: { statusAt: "desc" },
      take: 5,
      select: { actionEn: true, statusAt: true, outcome: true },
    }),
  ]);
  const lines = ["", "## Recommendations (the app's weekly tips, from the Recommendations page)"];
  if (run) lines.push(`Latest analysis: ${day(run.createdAt)}`);
  if (current.length) lines.push(...current.map((t, i) => `Tip ${i + 1}${t.impact ? ` (${t.impact} impact)` : ""}: ${t.actionEn} Why: ${t.rationaleEn} (based on ${t.basedOnPosts} posts)`));
  else lines.push("No open tips this week.");
  for (const d of done) {
    const outcome = d.outcome ? outcomeSummary(d.outcome as unknown as OutcomeResult) : "result not measured yet (it's checked 7 days after Done)";
    lines.push(`Done on ${d.statusAt ? day(d.statusAt) : "?"}: ${d.actionEn} — result: ${outcome}`);
  }
  return { lines, current: current.length };
}

/** The Gallery in numbers and the three most recent drafts (own data only; a demo's sample photos are on screen only). */
async function galleryFacts(businessId: string): Promise<string[]> {
  const [own, favourites, albums, drafts, recent, connection] = await Promise.all([
    db.galleryPhoto.count({ where: { businessId, status: "READY", removedAt: null, source: { in: ["UPLOADED", "AI_GENERATED"] } } }),
    db.galleryPhoto.count({ where: { businessId, status: "READY", removedAt: null, favorite: true } }),
    db.galleryAlbum.count({ where: { businessId } }),
    db.postDraft.count({ where: { businessId, ...GALLERY_DRAFT_WHERE } }),
    db.postDraft.findMany({ where: { businessId, ...GALLERY_DRAFT_WHERE }, orderBy: { updatedAt: "desc" }, take: 3, select: { updatedAt: true, captionEn: true, captionAr: true, suggestedFor: true, photos: { select: { photoId: true } } } }),
    db.instagramConnection.findUnique({ where: { businessId }, select: { provider: true } }),
  ]);
  const igPosts = connection?.provider === "META" ? await db.instagramMedia.count({ where: { businessId } }) : null;
  const lines = [
    "",
    "## Gallery and drafts",
    `Own photos (uploaded or AI-made): ${own}; favourites: ${favourites}; albums: ${albums}${igPosts !== null ? `; Instagram posts in the Gallery: ${igPosts}` : ""}`,
    connection?.provider === "MOCK" ? "Demo account: the Gallery also shows the app's sample photos." : null,
    `Saved post drafts (not published; publishing from drafts isn't available yet): ${drafts}`,
    ...recent.map((d) => {
      const caption = (d.captionEn || d.captionAr || "").replace(/\s+/g, " ").slice(0, 100);
      return `Draft saved ${day(d.updatedAt)}, ${d.photos.length} photo${d.photos.length === 1 ? "" : "s"}${d.suggestedFor ? `, suggested for ${d.suggestedFor.toISOString().slice(0, 16).replace("T", " ")} UTC` : ""}${caption ? `: "${caption}"` : ""}`;
    }),
  ];
  return lines.filter((l): l is string => l !== null);
}
