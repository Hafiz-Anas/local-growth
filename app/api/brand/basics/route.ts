import { db } from "@/lib/db";
import { logActivity } from "@/lib/server/activity";
import { getBrandBasics, saveBrandBasics } from "@/lib/server/brand";
import { requireBusiness } from "@/lib/server/guards";
import { handler, ok, readJson } from "@/lib/server/http";
import { brandBasicsSchema } from "@/lib/validation/api";

/**
 * PUT /api/brand/basics  { colors?, languages?, toneLevel?, wordsToUse?, wordsToAvoid? } — step 5 and
 * Settings → Brand profile (posting language). Only the fields sent are changed; the logo has its own route.
 */
export const PUT = handler(async (request) => {
  const { businessId, session } = await requireBusiness();
  const input = await readJson(request, brandBasicsSchema);
  await db.$transaction(async (tx) => {
    await saveBrandBasics(tx, businessId, { ...input, colors: input.colors && [...new Set(input.colors)], languages: input.languages && [...new Set(input.languages)] });
    await logActivity({ businessId, userId: session.userId, action: "brand.basics_updated" }, tx);
  });
  return ok(await getBrandBasics(businessId));
});
