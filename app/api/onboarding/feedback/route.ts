import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { requireBusiness } from "@/lib/server/guards";
import { ApiError, handler, ok, readJson } from "@/lib/server/http";
import { FEEDBACK_LIMIT, getRateLimiter } from "@/lib/server/rate-limit";
import { feedbackSchema } from "@/lib/validation/api";

/**
 * POST /api/onboarding/feedback  { step, note, context? }
 * "Report a problem" from the wizard: the note, the step and screenshot-free
 * context, shown to admins on the Onboarding page.
 */
export const POST = handler(async (request) => {
  const { businessId, session } = await requireBusiness();
  if (!(await getRateLimiter().consume(FEEDBACK_LIMIT, businessId))) throw new ApiError(429, "rate_limited", "Too many reports. Please try again later.");
  const { step, note, context } = await readJson(request, feedbackSchema);
  const userAgent = request.headers.get("user-agent")?.slice(0, 300) ?? null;
  const saved = await db.feedback.create({
    data: { businessId, userId: session.userId, step, note, context: { ...(context ?? {}), userAgent } as Prisma.InputJsonObject },
    select: { id: true },
  });
  return ok(saved, { status: 201 });
});
