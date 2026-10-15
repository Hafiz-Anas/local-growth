import { requireFeature } from "@/lib/server/guards";
import { handler, ok, readJson, readParams } from "@/lib/server/http";
import { regenerateReply } from "@/lib/server/replies";
import { regenerateReplySchema } from "@/lib/validation/api";

/**
 * POST /api/reply-drafts/:id/regenerate  { tone?: "shorter" | "formal" | "friendly" } — a new AI draft
 * for a pending AI reply (lib/server/replies.ts). 503 regenerate_unavailable when the AI can't write
 * (editing and sending still work), 429 regenerate_limit after many requests in an hour.
 */
export const POST = handler(async (request, context: RouteContext<"/api/reply-drafts/[id]/regenerate">) => {
  const { businessId } = await requireFeature("engagement.aiReplies");
  const { id } = await readParams(context, "id");
  const hasBody = request.headers.get("content-type")?.includes("application/json") ?? false;
  const { tone } = hasBody ? await readJson(request, regenerateReplySchema) : { tone: null };
  return ok(await regenerateReply(businessId, id, tone ?? null));
});
