import { createHash } from "node:crypto";

export { keyLast4, keyProblem, maskedKey, type KeyProblem } from "./ai-key-format";

/**
 * AI provider keys, the pure part (tests/ai-keys.test.ts): scopes, which key wins, validation and masking.
 * Storage, encryption and the admin routes are in lib/server/ai-keys.ts.
 *
 * Scopes (`AiKey.scopeKey`): "platform", "business:<id>", and — reserved, nothing writes them yet — "plan:<PLAN>".
 * Which key a business's AI call uses: its own → its plan's → the platform's → GEMINI_API_KEY from the environment.
 */

export type AiKeyProvider = "gemini";
export type AiKeySource = "business" | "plan" | "platform" | "env";

export const PLATFORM_SCOPE = "platform";
export const businessScope = (businessId: string) => `business:${businessId}`;
export const planScope = (plan: string) => `plan:${plan.toUpperCase()}`;

/** The scopes to look up, best first. `plan` is for plan-based keys later. */
export function candidateScopes(input: { businessId?: string | null; plan?: string | null }): string[] {
  return [...(input.businessId ? [businessScope(input.businessId)] : []), ...(input.plan ? [planScope(input.plan)] : []), PLATFORM_SCOPE];
}

export function sourceOfScope(scopeKey: string): Exclude<AiKeySource, "env"> {
  return scopeKey === PLATFORM_SCOPE ? "platform" : scopeKey.startsWith("plan:") ? "plan" : "business";
}

export interface KeyCandidate {
  scopeKey: string;
  apiKey: string;
}

export interface ResolvedKey {
  apiKey: string;
  source: AiKeySource;
  /** Identifies the key without revealing it: request limits are kept per key. */
  fingerprint: string;
}

export const keyFingerprint = (apiKey: string) => createHash("sha256").update(apiKey).digest("hex").slice(0, 12);

/** The first usable stored key in the order of `order`, else the environment's. Null when there is none. */
export function pickKey(order: string[], stored: KeyCandidate[], envKey: string | undefined): ResolvedKey | null {
  for (const scopeKey of order) {
    const found = stored.find((s) => s.scopeKey === scopeKey && s.apiKey.trim());
    if (found) return { apiKey: found.apiKey.trim(), source: sourceOfScope(scopeKey), fingerprint: keyFingerprint(found.apiKey.trim()) };
  }
  const env = envKey?.trim();
  return env ? { apiKey: env, source: "env", fingerprint: keyFingerprint(env) } : null;
}
