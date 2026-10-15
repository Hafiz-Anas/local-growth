import "server-only";
import { db } from "@/lib/db";
import { mentionsIn, methodMix, promotedVsOrganic, rankMethods, ruleMethod, isMethod, type ClassifiedPost, type Method } from "@/lib/analysis/methods";
import { getAIService } from "@/lib/services/ai";
import { classifyDataBlock } from "@/lib/services/text/analysis";
import type { MethodPostDto, MethodsDto } from "@/types";
import { competitorProfileFor } from "./competitor-profiles";
import { isFeatureEnabled } from "@/lib/permissions";
import type { Permissions } from "@/types";
import { getInstagramAccount } from "./instagram-account";
import { notFound } from "./http";
import { competitorPosts, ownPosts } from "./post-data";
import { getRateLimiter, METHODS_AI_LIMIT } from "./rate-limit";

/**
 * Marketing methods (feature "methods"): each of the business's recent posts gets a method —
 * first from the caption rules, then the AI's suggestion (one batched call, at most
 * METHODS_AI_LIMIT per business per hour, through the AI's daily budget), and the client's own
 * choice wins for good. "Promoted" is the client's flag. The ranking compares averages
 * (correlation, not causation) and always says how many posts each number rests on.
 */

/** Posts sent to the AI in one call. */
const AI_BATCH = 20;

type StoredMethod = { igMediaId: string; method: string; source: "RULE" | "AI" | "USER"; promoted: boolean };

/**
 * Makes sure every post has a stored method: rules for new ones, then one AI call for the ones
 * only the rules have seen. Returns the stored rows and whether the AI was used.
 */
async function classify(businessId: string, posts: ClassifiedPostInput[], handle: string, useAi: boolean): Promise<{ rows: Map<string, StoredMethod>; ai: MethodsDto["ai"] }> {
  const ids = posts.map((p) => p.id);
  const existing = await db.postMethod.findMany({ where: { businessId, igMediaId: { in: ids } }, select: { igMediaId: true, method: true, source: true, promoted: true } });
  const rows = new Map(existing.map((r) => [r.igMediaId, r as StoredMethod]));

  const fresh = posts.filter((p) => !rows.has(p.id));
  if (fresh.length) {
    await db.postMethod.createMany({ data: fresh.map((p) => ({ businessId, igMediaId: p.id, method: ruleMethod(p.caption, handle), source: "RULE" as const })), skipDuplicates: true });
    for (const p of fresh) rows.set(p.id, { igMediaId: p.id, method: ruleMethod(p.caption, handle), source: "RULE", promoted: false });
  }

  const todo = posts.filter((p) => rows.get(p.id)?.source === "RULE").slice(0, AI_BATCH);
  if (!todo.length) return { rows, ai: { status: "not_needed", reason: null } };
  if (!useAi) return { rows, ai: { status: "pending", reason: null } };
  const ai = getAIService();
  const availability = ai.textAvailability();
  if (!availability.available) return { rows, ai: { status: "unavailable", reason: availability.reason } };
  if (!(await getRateLimiter().consume(METHODS_AI_LIMIT, businessId))) return { rows, ai: { status: "unavailable", reason: "rate_limited" } };

  const answer = await ai.classifyPosts({
    businessId,
    ids: todo.map((p) => p.id),
    data: classifyDataBlock(todo.map((p) => ({ id: p.id, format: p.format, caption: p.caption, mentions: mentionsIn(p.caption, handle) }))),
  });
  if (!answer.ok) return { rows, ai: { status: "unavailable", reason: answer.reason } };
  for (const [id, method] of answer.methods) {
    // Never overwrite the client's choice (it may have been set while the AI was answering).
    const updated = await db.postMethod.updateMany({ where: { businessId, igMediaId: id, source: { not: "USER" } }, data: { method, source: "AI" } });
    if (updated.count) rows.set(id, { ...rows.get(id)!, method, source: "AI" });
  }
  return { rows, ai: { status: "used", reason: null } };
}

type ClassifiedPostInput = { id: string; caption: string; format: string };

const SOURCE = { RULE: "rule", AI: "ai", USER: "user" } as const;

/** The methods page: every recent post with its method, the ranking and promoted vs normal. */
export async function methodsOverview(businessId: string, permissions: Permissions, { useAi = false } = {}): Promise<MethodsDto> {
  const own = await ownPosts(businessId);
  const { rows, ai } = await classify(businessId, own.posts, own.handle, useAi);
  const posts: MethodPostDto[] = own.posts.map((p) => {
    const row = rows.get(p.id);
    const media = own.media.get(p.id);
    return {
      ...p,
      mediaUrl: media?.mediaUrl ?? null,
      permalink: media?.permalink ?? null,
      method: isMethod(row?.method) ? row.method : "other",
      source: SOURCE[row?.source ?? "RULE"],
      promoted: row?.promoted ?? false,
    };
  });
  const classified: ClassifiedPost[] = posts.map((p) => ({ ...p }));

  // Competitors' content types where we have their posts (rules only, labelled as estimates).
  let competitors: MethodsDto["competitors"] = [];
  if (isFeatureEnabled(permissions, "competitors.accounts")) {
    const account = await getInstagramAccount(businessId);
    const tracked = await db.competitor.findMany({ where: { businessId, validationStatus: "READY" }, select: { id: true, handle: true }, orderBy: { followers: "desc" } });
    const profiles = await Promise.all(tracked.map((c) => competitorProfileFor(account, c).catch(() => null)));
    competitors = tracked
      .map((c, i) => {
        const theirs = profiles[i] ? competitorPosts(profiles[i]!) : [];
        return { handle: c.handle, posts: theirs.length, methods: methodMix(theirs, c.handle) };
      })
      .filter((c) => c.posts > 0);
  }

  return { connected: own.connected, demo: own.demo, posts, ranking: rankMethods(classified), promoted: promotedVsOrganic(classified), ai, competitors };
}

/** One tap: the client's method and/or "promoted" for a post (stored as the client's, never overwritten). */
export async function setPostMethod(businessId: string, igMediaId: string, patch: { method?: Method; promoted?: boolean }) {
  const own = await ownPosts(businessId);
  const post = own.posts.find((p) => p.id === igMediaId);
  if (!post) throw notFound("Post");
  const current = await db.postMethod.findUnique({ where: { businessId_igMediaId: { businessId, igMediaId } }, select: { method: true, source: true } });
  const method = patch.method ?? current?.method ?? ruleMethod(post.caption, own.handle);
  const source = patch.method ? ("USER" as const) : (current?.source ?? ("RULE" as const));
  return db.postMethod.upsert({
    where: { businessId_igMediaId: { businessId, igMediaId } },
    create: { businessId, igMediaId, method, source, promoted: patch.promoted ?? false },
    update: { method, source, ...(patch.promoted !== undefined && { promoted: patch.promoted }) },
    select: { igMediaId: true, method: true, source: true, promoted: true },
  });
}

/** Daily cron: classify new posts (rules + one AI batch) for businesses with the feature. */
export async function classifyNewPosts(businessId: string, permissions: Permissions): Promise<"used" | "skipped"> {
  const result = await methodsOverview(businessId, permissions, { useAi: true });
  return result.ai.status === "used" ? "used" : "skipped";
}
