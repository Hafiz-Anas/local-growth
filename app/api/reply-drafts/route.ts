import type { ReplyDraftStatus } from "@/lib/generated/prisma/client";
import { listReplies } from "@/lib/server/data";
import { requireAnyFeature } from "@/lib/server/guards";
import { handler, ok, readQuery } from "@/lib/server/http";
import { replyKinds } from "@/lib/server/replies";
import { replyStatusQuery } from "@/lib/validation/api";

/** GET /api/reply-drafts?status=pending|approved|dismissed|posted — default: pending. AI and/or keyword reply drafts, by feature. */
export const GET = handler(async (request) => {
  const { businessId, permissions } = await requireAnyFeature("engagement.aiReplies", "engagement.dmRules");
  const { status } = readQuery(request, replyStatusQuery);
  return ok(await listReplies(businessId, (status?.toUpperCase() ?? "PENDING") as ReplyDraftStatus, replyKinds(permissions)));
});
