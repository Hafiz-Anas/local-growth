import { db } from "@/lib/db";
import { requireRole } from "@/lib/server/guards";
import { handler, ok } from "@/lib/server/http";
import { getInstagramAccount } from "@/lib/server/instagram-account";
import { getInstagramService } from "@/lib/services/instagram";
import type { AdminSystemDto } from "@/types";

/** GET /api/admin/system — Instagram API / webhook health and per-business API usage. */
export const GET = handler(async () => {
  await requireRole("ADMIN");
  const ig = getInstagramService();
  const businesses = await db.business.findMany({ select: { id: true }, orderBy: { createdAt: "asc" } });
  const [health, usage] = await Promise.all([
    ig.getApiHealth(),
    Promise.all(businesses.map(async (b) => ({ businessId: b.id, ...(await ig.getRateLimitUsage(await getInstagramAccount(b.id))) }))),
  ]);
  const dto: AdminSystemDto = { ...health, rateLimits: usage };
  return ok(dto);
});
