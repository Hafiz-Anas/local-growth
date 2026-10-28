import { db } from "@/lib/db";
import { loadBusinessFocus } from "@/lib/server/business-focus";
import { competitorProfileFor } from "@/lib/server/competitor-profiles";
import { findOwnCompetitor } from "@/lib/server/competitors";
import { requireFeature } from "@/lib/server/guards";
import { ApiError, handler, ok, readJson } from "@/lib/server/http";
import { getInstagramAccount } from "@/lib/server/instagram-account";
import { AI_CHAT_LIMIT, getRateLimiter } from "@/lib/server/rate-limit";
import { getAIService } from "@/lib/services/ai";
import { similarPostSchema } from "@/lib/validation/api";
import type { SimilarPostDto } from "@/types";

/**
 * POST /api/ai-chat/similar-post { competitorId, postId, photo } — "Create a similar post" in the AI tab,
 * from a competitor's post opened in the viewer. The post is looked up among the business's own tracked
 * competitors (404 otherwise); only its caption, format and counts go to the AI, never the image.
 * `{ post }` is the AI's explanation (topic, style, hook) and a new EN + AR post for the owner's photo, or
 * null when the AI is off, over its budget (AI_CHAT_LIMIT, shared with typed questions, plus the text
 * request gate), failed, or copied the competitor: the chat then writes its sample answer
 * (components/ai-chat/engine.ts). Nothing is stored.
 */
export const POST = handler(async (request) => {
  const { businessId } = await requireFeature("aiChat", "competitors");
  const body = await readJson(request, similarPostSchema);
  const competitor = await findOwnCompetitor(businessId, body.competitorId);
  const profile = await competitorProfileFor(await getInstagramAccount(businessId), competitor);
  const post = profile?.recentPosts.find((p) => p.id === body.postId);
  if (!post) throw new ApiError(404, "not_found", "Post not found.");

  const ai = getAIService();
  if (!ai.textAvailability().available || !(await getRateLimiter().consume(AI_CHAT_LIMIT, businessId))) return ok<{ post: SimilarPostDto | null }>({ post: null });

  const business = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { name: true, nameAr: true } });
  const answer = await ai.similarPost({
    businessId,
    prompt: {
      businessName: business.name,
      businessNameAr: business.nameAr,
      focus: (await loadBusinessFocus(businessId)) ?? undefined,
      competitor: { handle: competitor.handle, caption: post.caption ?? "", format: post.format ?? null, likes: post.likes, comments: post.comments },
      photo: { name: body.photo.name, nameAr: body.photo.nameAr ?? null, category: body.photo.category ?? null },
    },
  });
  return ok<{ post: SimilarPostDto | null }>({ post: answer.ok ? answer.post : null });
});
