import { approveChatAction } from "@/lib/server/chat-actions";
import { requireFeature } from "@/lib/server/guards";
import { handler, ok, readParams } from "@/lib/server/http";

/** Up to 20 photos are prepared for Instagram while a "schedule" / "post now" approval waits. */
export const maxDuration = 60;

/**
 * POST /api/ai-chat/actions/:id/approve — Approve on an AI action card (AI4). Runs the proposal with the publishing
 * services after checking it again (expired after 30 minutes, publishing switched off, the post changed meanwhile);
 * answers `{ message }`: the card in its new state (done, or failed with the reason). Another business's action: 404.
 * Admin preview can't call it (a USER route).
 */
export const POST = handler(async (_request, context: RouteContext<"/api/ai-chat/actions/[id]/approve">) => {
  const { businessId, permissions, session } = await requireFeature("aiChat");
  const { id } = await readParams(context, "id");
  return ok({ message: await approveChatAction(businessId, session.userId, permissions, id) });
});
