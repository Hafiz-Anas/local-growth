import { listDrafts } from "@/lib/server/data";
import { requireFeature } from "@/lib/server/guards";
import { handler, ok, readQuery } from "@/lib/server/http";
import { draftStatusQuery } from "@/lib/validation/api";
import type { DraftStatus } from "@/lib/generated/prisma/client";

/** GET /api/post-drafts?status=draft|queued|published|rejected — default: drafts and queued. */
export const GET = handler(async (request) => {
  const { businessId } = await requireFeature("postGenerator");
  const { status } = readQuery(request, draftStatusQuery);
  return ok(await listDrafts(businessId, status?.toUpperCase() as DraftStatus | undefined));
});
