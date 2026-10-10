import { getGeneratorOptions } from "@/lib/server/data";
import { requireFeature } from "@/lib/server/guards";
import { handler, ok } from "@/lib/server/http";

/** GET /api/post-generator/options — categories, occasions and (if enabled) brand vocabulary. */
export const GET = handler(async () => {
  const { businessId, permissions } = await requireFeature("postGenerator");
  return ok(await getGeneratorOptions(businessId, permissions));
});
