import { ImageGenerationError, sanitizeImageError, type ImageFailureReason } from "./errors";
import { sniffImage, type ImageExtension } from "../../uploads/sniff";

/**
 * Google Gemini image generation (models/{model}:generateContent with image
 * output). Pure: the key and fetch are passed in, so tests run against
 * recorded responses (tests/gemini/fixtures.json) and never call Google.
 * The key travels in the x-goog-api-key header — never in the URL or logs.
 */

export const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
export const DEFAULT_GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image";
const TIMEOUT_MS = 90_000;

export interface GeminiImageConfig {
  apiKey: string;
  model: string;
  /** Overridable for tests. */
  baseUrl?: string;
  timeoutMs?: number;
}

export interface GeminiImage {
  data: Buffer;
  extension: ImageExtension;
  model: string;
}

/** Reads GEMINI_API_KEY / GEMINI_IMAGE_MODEL (and GEMINI_API_BASE, for a local stub in end-to-end tests); null when the key is missing. */
export function readGeminiConfig(env: Record<string, string | undefined> = process.env): GeminiImageConfig | null {
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  const baseUrl = env.GEMINI_API_BASE?.trim();
  return { apiKey, model: env.GEMINI_IMAGE_MODEL?.trim() || DEFAULT_GEMINI_IMAGE_MODEL, ...(baseUrl && { baseUrl }) };
}

export function geminiRequestBody(prompt: string) {
  return {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: "1:1" } },
  };
}

interface GeminiErrorBody {
  error?: {
    code?: number;
    status?: string;
    message?: string;
    details?: Array<{ "@type"?: string; reason?: string; violations?: Array<{ quotaId?: string; quotaMetric?: string }> }>;
  };
}

/** Maps a Gemini error response to what we tell the user. */
export function classifyGeminiError(httpStatus: number, body: unknown): ImageFailureReason {
  const error = (body as GeminiErrorBody | null)?.error ?? {};
  const status = error.status ?? "";
  const message = error.message ?? "";
  const details = error.details ?? [];
  const reasons = details.map((d) => d.reason ?? "");
  const quotaIds = details.flatMap((d) => d.violations ?? []).map((v) => `${v.quotaId ?? ""} ${v.quotaMetric ?? ""}`);

  if (reasons.includes("API_KEY_INVALID") || reasons.includes("API_KEY_SERVICE_BLOCKED") || /api key (not valid|expired|invalid)/i.test(message)) return "invalid_key";
  if (reasons.includes("SERVICE_DISABLED") || reasons.includes("CONSUMER_INVALID")) return "invalid_key";

  // Quota messages always say "check your plan and billing details", so look at quotas first.
  if (httpStatus === 429 || status === "RESOURCE_EXHAUSTED") {
    // "limit: 0" on a free-tier metric means the model isn't on the free tier at all.
    if (/limit:\s*0\b/.test(message)) return "billing";
    if (quotaIds.some((q) => /per\s*day|perday/i.test(q)) || /per day|daily/i.test(message)) return "daily_limit";
    return "rate_limited";
  }
  if (/billing|billed users/i.test(message) || reasons.includes("BILLING_DISABLED")) return "billing";
  if (/location is not supported|not available in your (country|region)/i.test(message)) return "region";
  if (httpStatus === 401 || httpStatus === 403 || status === "PERMISSION_DENIED" || status === "UNAUTHENTICATED") return "invalid_key";
  if (httpStatus === 404 || status === "NOT_FOUND") return "model_unavailable";
  if (/response modalit|does not support (image|the requested)/i.test(message)) return "model_unavailable";
  if (httpStatus >= 500 || status === "UNAVAILABLE" || status === "INTERNAL" || status === "DEADLINE_EXCEEDED") return "unavailable";
  return "request_rejected";
}

const BLOCK_REASONS = /SAFETY|PROHIBITED|BLOCKLIST|SPII|RECITATION/;

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
  inline_data?: { mime_type?: string; data?: string };
}
interface GeminiResponse {
  candidates?: Array<{ finishReason?: string; content?: { parts?: GeminiPart[] } }>;
  promptFeedback?: { blockReason?: string };
}

/** The first image in a successful response, or an ImageGenerationError explaining why there is none. */
export function extractImage(body: unknown, model: string): GeminiImage {
  const response = (body ?? {}) as GeminiResponse;
  if (response.promptFeedback?.blockReason) {
    throw new ImageGenerationError("blocked", `Prompt blocked (${response.promptFeedback.blockReason}).`, 200, response.promptFeedback.blockReason);
  }
  for (const candidate of response.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      const data = part.inlineData?.data ?? part.inline_data?.data;
      if (!data) continue;
      const bytes = Buffer.from(data, "base64");
      const extension = sniffImage(bytes);
      if (!extension) throw new ImageGenerationError("no_image", "The image returned isn't a JPG, PNG or WebP.", 200);
      return { data: bytes, extension, model };
    }
  }
  const finish = response.candidates?.find((c) => c.finishReason)?.finishReason ?? "";
  if (BLOCK_REASONS.test(finish)) throw new ImageGenerationError("blocked", `Image blocked (${finish}).`, 200, finish);
  throw new ImageGenerationError("no_image", `No image in the response${finish ? ` (${finish})` : ""}.`, 200, finish || null);
}

/** Calls Gemini once and returns the image, or throws ImageGenerationError. */
export async function generateGeminiImage(config: GeminiImageConfig, prompt: string, fetchImpl: typeof fetch = fetch): Promise<GeminiImage> {
  const url = `${config.baseUrl ?? GEMINI_API_BASE}/models/${encodeURIComponent(config.model)}:generateContent`;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": config.apiKey },
      body: JSON.stringify(geminiRequestBody(prompt)),
      signal: AbortSignal.timeout(config.timeoutMs ?? TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = (error as Error).name === "TimeoutError";
    throw new ImageGenerationError("unavailable", timedOut ? "Gemini didn't answer in time." : sanitizeImageError(`Network error: ${(error as Error).message}`));
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = (body as GeminiErrorBody | null)?.error;
    const reason = classifyGeminiError(res.status, body);
    throw new ImageGenerationError(reason, sanitizeImageError(error?.message ?? `HTTP ${res.status}`), res.status, error?.status ?? null);
  }
  return extractImage(body, config.model);
}
