import "server-only";
import { clearKey, getKeyStatus, setKey } from "@/lib/server/ai-keys";
import { ApiError } from "@/lib/server/http";
import { keyProblem } from "@/lib/services/ai-key-core";
import { logActivity } from "./activity";

type Scope = Parameters<typeof setKey>[0];

/** What GET answers: the status (last 4 characters only). */
export const keyView = (scope: Scope) => getKeyStatus(scope);

/** Shared by the platform and the client routes: validate, save, audit. */
export async function saveKey(scope: Scope, apiKey: string, userId: string) {
  const problem = keyProblem(apiKey);
  if (problem) throw new ApiError(400, "validation_error", "That doesn't look like an API key.", [{ path: "apiKey", message: problem }]);
  await setKey(scope, apiKey, userId);
  await logActivity({ businessId: scope.kind === "business" ? scope.businessId : null, userId, action: "ai_key.set", details: { scope: scope.kind } });
  return keyView(scope);
}

export async function removeKey(scope: Scope, userId: string) {
  if (await clearKey(scope, userId)) {
    await logActivity({ businessId: scope.kind === "business" ? scope.businessId : null, userId, action: "ai_key.cleared", details: { scope: scope.kind } });
  }
  return keyView(scope);
}
