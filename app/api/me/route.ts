import { db } from "@/lib/db";
import { BUSINESS_SUMMARY_SELECT, toBusinessSummary } from "@/lib/server/dto";
import { requireAuth } from "@/lib/server/guards";
import { handler, notFound, ok } from "@/lib/server/http";
import { notificationPrefsSchema, uiPreferencesSchema } from "@/lib/validation/api";
import type { MeDto } from "@/types";

/** GET /api/me — the signed-in user, their business and enabled features. */
export const GET = handler(async () => {
  const session = await requireAuth();
  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true, name: true, role: true, avatarUrl: true, uiPreferences: true, notificationPrefs: true, emailVerifiedAt: true, business: { select: BUSINESS_SUMMARY_SELECT } },
  });
  if (!user) throw notFound("User");
  const me: MeDto = {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: session.role,
      avatarUrl: user.avatarUrl,
      uiPreferences: uiPreferencesSchema.catch(uiPreferencesSchema.parse({})).parse(user.uiPreferences ?? {}),
      notifications: notificationPrefsSchema.catch(notificationPrefsSchema.parse({})).parse(user.notificationPrefs ?? {}),
      emailVerified: Boolean(user.emailVerifiedAt),
    },
    business: user.business ? toBusinessSummary(user.business) : null,
    features: session.features,
  };
  return ok(me);
});
