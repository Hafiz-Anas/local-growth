import "server-only";
import { decrypt, encrypt, encryptionKeyProblem } from "@/lib/crypto";
import { ApiError } from "@/lib/server/http";
import { db } from "@/lib/db";
import {
  PLATFORM_SCOPE,
  businessScope,
  candidateScopes,
  keyLast4,
  pickKey,
  type KeyCandidate,
  type ResolvedKey,
} from "@/lib/services/ai-key-core";
import { TextGenerationError, sanitizeTextError } from "@/lib/services/text/errors";
import { DEFAULT_GEMINI_TEXT_MODEL, generateGeminiText, readGeminiTextConfig } from "@/lib/services/text/gemini";
import type { AiKeyStatusDto, AiKeyTestDto } from "@/types";

/**
 * AI keys kept by admins: one for the platform, optionally one per business. Stored encrypted (lib/crypto.ts,
 * AES-256-GCM); the browser only ever gets the last 4 characters. Every AI call asks `resolveGeminiKey` for its key:
 * the business's own → (its plan's, later) → the platform's → GEMINI_API_KEY from the environment.
 */

const CACHE_MS = 15_000;
const cache = new Map<string, { at: number; keys: KeyCandidate[] }>();

const cacheKey = (scopes: string[]) => scopes.join("|");

async function storedKeys(scopes: string[]): Promise<KeyCandidate[]> {
  const hit = cache.get(cacheKey(scopes));
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.keys;
  const rows = await db.aiKey.findMany({ where: { scopeKey: { in: scopes }, provider: "gemini" }, select: { scopeKey: true, keyEncrypted: true } });
  const keys: KeyCandidate[] = [];
  for (const row of rows) {
    try {
      keys.push({ scopeKey: row.scopeKey, apiKey: decrypt(row.keyEncrypted) });
    } catch {
      // The encryption key changed or the row is damaged: this key can't be used; the next one in the order is.
      console.warn(`[ai-keys] couldn't decrypt the key for ${row.scopeKey}`);
    }
  }
  cache.set(cacheKey(scopes), { at: Date.now(), keys });
  return keys;
}

/** The key an AI call for this business uses (null = no key anywhere). Never logs or returns it to the browser. */
export async function resolveGeminiKey(businessId?: string | null): Promise<ResolvedKey | null> {
  const order = candidateScopes({ businessId });
  return pickKey(order, await storedKeys(order), process.env.GEMINI_API_KEY);
}

const forgetCached = () => cache.clear();

type Scope = { kind: "platform" } | { kind: "business"; businessId: string };
const scopeKeyOf = (scope: Scope) => (scope.kind === "platform" ? PLATFORM_SCOPE : businessScope(scope.businessId));

async function recordEvent(scope: Scope, action: "SET" | "CLEARED" | "TESTED", userId: string, ok?: boolean) {
  await db.aiKeyEvent.create({ data: { scopeKey: scopeKeyOf(scope), businessId: scope.kind === "business" ? scope.businessId : null, action, ok: ok ?? null, userId } });
}

export async function getKeyStatus(scope: Scope): Promise<AiKeyStatusDto> {
  const row = await db.aiKey.findUnique({ where: { scopeKey: scopeKeyOf(scope) }, select: { last4: true, updatedAt: true, updatedById: true } });
  const updater = row?.updatedById ? await db.user.findUnique({ where: { id: row.updatedById }, select: { name: true } }) : null;
  const effective = await resolveGeminiKey(scope.kind === "business" ? scope.businessId : null);
  return {
    set: Boolean(row),
    last4: row?.last4 ?? null,
    updatedAt: row?.updatedAt.toISOString() ?? null,
    updatedByName: updater?.name ?? null,
    effective: { source: effective?.source ?? "none", last4: effective ? keyLast4(effective.apiKey) : null },
    envConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
    encryptionReady: encryptionKeyProblem() === null,
  };
}

/** Saves (or replaces) a key; the audit row records who and when, never the key. */
export async function setKey(scope: Scope, apiKey: string, userId: string): Promise<void> {
  // A clear admin message instead of a crash when the server has no (valid) ENCRYPTION_KEY.
  if (encryptionKeyProblem()) {
    throw new ApiError(503, "encryption_not_configured", "The server has no valid ENCRYPTION_KEY, so keys can't be saved yet. Add it in the hosting settings and redeploy.");
  }
  const key = apiKey.trim();
  const data = { keyEncrypted: encrypt(key), last4: keyLast4(key), updatedById: userId };
  await db.aiKey.upsert({
    where: { scopeKey: scopeKeyOf(scope) },
    create: { scopeKey: scopeKeyOf(scope), scope: scope.kind, businessId: scope.kind === "business" ? scope.businessId : null, provider: "gemini", ...data },
    update: data,
  });
  forgetCached();
  await recordEvent(scope, "SET", userId);
}

/** Removes a saved key (a business then uses the platform key; the platform then uses the environment's). */
export async function clearKey(scope: Scope, userId: string): Promise<boolean> {
  const { count } = await db.aiKey.deleteMany({ where: { scopeKey: scopeKeyOf(scope) } });
  forgetCached();
  if (count) await recordEvent(scope, "CLEARED", userId);
  return count > 0;
}

/**
 * "Test key": one tiny Gemini call with the typed key, or else the key this scope would use. Says OK or the
 * reason; the key itself is never in the answer or the log.
 */
export async function testKey(scope: Scope, typedKey: string | null, userId: string): Promise<AiKeyTestDto> {
  const resolved = typedKey ? null : await resolveGeminiKey(scope.kind === "business" ? scope.businessId : null);
  const apiKey = (typedKey ?? resolved?.apiKey)?.trim();
  const source: AiKeyTestDto["source"] = typedKey ? "typed" : (resolved?.source ?? "env");
  if (!apiKey) return { ok: false, reason: "not_configured", message: "No key is set.", source };

  const config = readGeminiTextConfig({ ...process.env, GEMINI_API_KEY: apiKey });
  let result: AiKeyTestDto;
  try {
    await generateGeminiText(config ?? { apiKey, model: DEFAULT_GEMINI_TEXT_MODEL, rpm: 1, rpd: 1 }, {
      system: "You check that an API key works. Answer with the single word OK.",
      user: "Say OK.",
      temperature: 0,
      maxOutputTokens: 64,
      timeoutMs: 15_000,
    });
    result = { ok: true, reason: null, message: null, source };
  } catch (error) {
    const failure = error instanceof TextGenerationError ? error : new TextGenerationError("unavailable", sanitizeTextError((error as Error).message));
    // A blocked or empty answer still proves the key was accepted.
    const accepted = failure.reason === "blocked" || failure.reason === "bad_output";
    result = { ok: accepted, reason: accepted ? null : failure.reason, message: accepted ? null : failure.message.split(apiKey).join("…"), source };
  }
  await recordEvent(scope, "TESTED", userId, result.ok);
  return result;
}
