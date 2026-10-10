import type { Prisma } from "@/lib/generated/prisma/client";
import { handler, ok, readJson } from "@/lib/server/http";
import { recordAbandoned, recordEvent, recordStepStarted, requireOnboarding } from "@/lib/server/onboarding";
import { onboardingEventSchema } from "@/lib/validation/api";

/**
 * POST /api/onboarding/events  { step, event: "started" | "error" | "abandoned", details? }
 * Events only the browser sees: a step opened, a file rejected before upload,
 * the page closed mid-step (sent with navigator.sendBeacon, so any content type).
 */
export const POST = handler(async (request) => {
  const { businessId } = await requireOnboarding();
  const { step, event, details } = await readJson(request, onboardingEventSchema);
  const json = (details ?? {}) as Prisma.InputJsonObject;
  if (event === "started") await recordStepStarted(businessId, step);
  else if (event === "abandoned") await recordAbandoned(businessId, step, json);
  else await recordEvent(businessId, step, "error", { details: { ...json, source: "browser" } });
  return ok({ recorded: true });
});
