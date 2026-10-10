import { db } from "@/lib/db";
import { logActivity } from "@/lib/server/activity";
import { getBrandVoice } from "@/lib/server/data";
import { requireFeature } from "@/lib/server/guards";
import { handler, ok, readJson } from "@/lib/server/http";
import { brandVoiceSchema } from "@/lib/validation/api";

/** GET /api/brand-voice */
export const GET = handler(async () => {
  const { businessId } = await requireFeature("settings.brandVoice");
  return ok(await getBrandVoice(businessId));
});

/** PATCH /api/brand-voice  { toneLevel?, defaultHashtags?, brandWords?, whatsappNumber? } */
export const PATCH = handler(async (request) => {
  const { businessId, session } = await requireFeature("settings.brandVoice");
  const patch = await readJson(request, brandVoiceSchema);
  await db.brandVoice.upsert({ where: { businessId }, update: patch, create: { businessId, ...patch } });
  await logActivity({ businessId, userId: session.userId, action: "brand_voice.updated", details: { fields: Object.keys(patch) } });
  return ok(await getBrandVoice(businessId));
});
