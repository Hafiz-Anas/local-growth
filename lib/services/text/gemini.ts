import { classifyGeminiError } from "../images/gemini";
import { TextGenerationError, sanitizeTextError } from "./errors";
import type { TextPrompt } from "./prompts";

/**
 * Google Gemini text generation (models/{model}:generateContent). Pure: the
 * key and fetch are passed in, so tests run against recorded responses
 * (tests/gemini/text-fixtures.json) and never call Google. The key travels in
 * the x-goog-api-key header — never in the URL or logs. Error classification
 * is shared with the image client (lib/services/images/gemini.ts).
 */

export const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
/** Fast, cheap and on Gemini's free tier. Override with GEMINI_TEXT_MODEL. */
export const DEFAULT_GEMINI_TEXT_MODEL = "gemini-3.5-flash-lite";
/**
 * Our own budgets (per server instance), kept under the free tier of the
 * default model (15 requests/minute, 500/day). Raise them with GEMINI_TEXT_RPM
 * / GEMINI_TEXT_RPD on a paid plan.
 */
export const DEFAULT_GEMINI_TEXT_RPM = 12;
export const DEFAULT_GEMINI_TEXT_RPD = 450;

export interface GeminiTextConfig {
  apiKey: string;
  model: string;
  /** Our own per-minute request budget (GEMINI_TEXT_RPM). */
  rpm: number;
  /** Our own daily request budget (GEMINI_TEXT_RPD); the day resets at midnight Pacific time, like Google's quota. */
  rpd: number;
  /** Overridable for tests and local stubs (GEMINI_API_BASE). */
  baseUrl?: string;
}

const positiveInt = (value: string | undefined, fallback: number) => {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** Reads GEMINI_API_KEY / GEMINI_TEXT_MODEL / GEMINI_TEXT_RPM / GEMINI_TEXT_RPD (and GEMINI_API_BASE); null when the key is missing. */
export function readGeminiTextConfig(env: Record<string, string | undefined> = process.env): GeminiTextConfig | null {
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  const baseUrl = env.GEMINI_API_BASE?.trim();
  return {
    apiKey,
    model: env.GEMINI_TEXT_MODEL?.trim() || DEFAULT_GEMINI_TEXT_MODEL,
    rpm: positiveInt(env.GEMINI_TEXT_RPM, DEFAULT_GEMINI_TEXT_RPM),
    rpd: positiveInt(env.GEMINI_TEXT_RPD, DEFAULT_GEMINI_TEXT_RPD),
    ...(baseUrl && { baseUrl }),
  };
}

export function geminiTextRequestBody(prompt: TextPrompt) {
  return {
    systemInstruction: { parts: [{ text: prompt.system }] },
    contents: [
      ...(prompt.history ?? []).map((turn) => ({ role: turn.role, parts: [{ text: turn.text }] })),
      { role: "user", parts: [{ text: prompt.user }] },
    ],
    generationConfig: {
      temperature: prompt.temperature,
      maxOutputTokens: prompt.maxOutputTokens,
      ...(prompt.schema ? { responseMimeType: "application/json", responseSchema: prompt.schema } : { responseMimeType: "text/plain" }),
    },
  };
}

interface GeminiErrorBody {
  error?: { status?: string; message?: string; details?: Array<{ "@type"?: string; retryDelay?: string }> };
}

/** RetryInfo.retryDelay ("58863s" or "1.5s") in ms, when the provider sent one. */
export function retryDelayMs(body: unknown): number | null {
  const details = (body as GeminiErrorBody | null)?.error?.details ?? [];
  const delay = details.find((d) => d["@type"]?.endsWith("RetryInfo"))?.retryDelay;
  const seconds = delay ? Number.parseFloat(delay) : Number.NaN;
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : null;
}

const BLOCK_REASONS = /SAFETY|PROHIBITED|BLOCKLIST|SPII|RECITATION/;

interface GeminiTextResponse {
  candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
  promptFeedback?: { blockReason?: string };
}

/** The answer's text, or a TextGenerationError explaining why there is none. */
export function extractText(body: unknown): string {
  const response = (body ?? {}) as GeminiTextResponse;
  if (response.promptFeedback?.blockReason) {
    throw new TextGenerationError("blocked", `Prompt blocked (${response.promptFeedback.blockReason}).`, 200, response.promptFeedback.blockReason);
  }
  const candidate = response.candidates?.[0];
  const finish = candidate?.finishReason ?? "";
  if (BLOCK_REASONS.test(finish)) throw new TextGenerationError("blocked", `Answer blocked (${finish}).`, 200, finish);
  const text = (candidate?.content?.parts ?? [])
    .filter((p) => !p.thought)
    .map((p) => p.text ?? "")
    .join("")
    .trim();
  // A MAX_TOKENS answer is cut off mid-sentence (or mid-JSON): don't use it.
  if (!text || finish === "MAX_TOKENS") throw new TextGenerationError("bad_output", `No usable text in the response${finish ? ` (${finish})` : ""}.`, 200, finish || null);
  return text;
}

/** Calls Gemini once and returns the answer's text, or throws TextGenerationError. */
export async function generateGeminiText(config: GeminiTextConfig, prompt: TextPrompt, fetchImpl: typeof fetch = fetch): Promise<string> {
  const url = `${config.baseUrl ?? GEMINI_API_BASE}/models/${encodeURIComponent(config.model)}:generateContent`;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": config.apiKey },
      body: JSON.stringify(geminiTextRequestBody(prompt)),
      signal: AbortSignal.timeout(prompt.timeoutMs),
    });
  } catch (error) {
    const timedOut = (error as Error).name === "TimeoutError";
    throw new TextGenerationError("unavailable", timedOut ? `Gemini didn't answer within ${prompt.timeoutMs / 1000}s.` : sanitizeTextError(`Network error: ${(error as Error).message}`));
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = (body as GeminiErrorBody | null)?.error;
    const classified = classifyGeminiError(res.status, body);
    // The shared classifier speaks in image terms; "no_image" can't come from an error response.
    const reason = classified === "no_image" ? "bad_output" : classified;
    throw new TextGenerationError(reason, sanitizeTextError(error?.message ?? `HTTP ${res.status}`), res.status, error?.status ?? null, retryDelayMs(body));
  }
  return extractText(body);
}
