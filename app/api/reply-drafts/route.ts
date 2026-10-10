import type { ReplyDraftStatus } from "@/lib/generated/prisma/client";
import { listReplies } from "@/lib/server/data";
import { requireFeature } from "@/lib/server/guards";
import { handler, ok, readQuery } from "@/lib/server/http";
import { replyStatusQuery } from "@/lib/validation/api";

/** GET /api/reply-drafts?status=pending|approved|dismissed|posted — default: pending. */
export const GET = handler(async (request) => {
  const { businessId } = await requireFeature("engagement.aiReplies");
  const { status } = readQuery(request, replyStatusQuery);
  return ok(await listReplies(businessId, (status?.toUpperCase() ?? "PENDING") as ReplyDraftStatus));
});
