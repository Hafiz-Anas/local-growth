import { requireRole } from "@/lib/server/guards";
import { ApiError, handler, ok, readJson } from "@/lib/server/http";
import { testKey } from "@/lib/server/ai-keys";
import { AI_KEY_TEST_LIMIT, getRateLimiter } from "@/lib/server/rate-limit";
import { keyProblem } from "@/lib/services/ai-key-core";
import { aiKeyTestSchema } from "@/lib/validation/api";

/**
 * POST /api/admin/ai-keys/test  { apiKey?, businessId? }
 * One small Gemini call: with the typed key, else with the key that scope would use (client → platform → environment).
 * Answers { ok, reason, message } — a wrong key is an answer, not an error.
 */
export const POST = handler(async (request) => {
  const session = await requireRole("ADMIN");
  const body = await readJson(request, aiKeyTestSchema);
  if (!(await getRateLimiter().consume(AI_KEY_TEST_LIMIT, session.userId))) throw new ApiError(429, "rate_limited", "Too many tests. Try again in a minute.");
  const typed = body.apiKey?.trim() || null;
  const problem = typed ? keyProblem(typed) : null;
  if (problem) throw new ApiError(400, "validation_error", "That doesn't look like an API key.", [{ path: "apiKey", message: problem }]);
  const scope = body.businessId ? ({ kind: "business", businessId: body.businessId } as const) : ({ kind: "platform" } as const);
  return ok(await testKey(scope, typed, session.userId));
});
