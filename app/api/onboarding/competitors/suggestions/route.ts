import { getCompetitorSuggestions, suggestCompetitors } from "@/lib/server/competitor-suggestions";
import { handler, ok } from "@/lib/server/http";
import { requireOnboarding } from "@/lib/server/onboarding";

/** One AI call and up to 6 Instagram checks. */
export const maxDuration = 60;

/** GET /api/onboarding/competitors/suggestions — stored suggestions (without accounts already listed). */
export const GET = handler(async () => {
  const { businessId } = await requireOnboarding();
  return ok(await getCompetitorSuggestions(businessId));
});

/**
 * POST /api/onboarding/competitors/suggestions — asks the AI for similar local accounts (once) and
 * keeps the ones Instagram confirms. Never fails because of the AI: status "unavailable" instead.
 */
export const POST = handler(async () => {
  const { businessId } = await requireOnboarding();
  return ok(await suggestCompetitors(businessId));
});
