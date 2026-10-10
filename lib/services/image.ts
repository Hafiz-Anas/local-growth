import "server-only";
import { ImageGenerationError, IMAGE_FAILURE_REASONS, type ImageFailureReason } from "./images/errors";
import { generateGeminiImage, readGeminiConfig } from "./images/gemini";
import { placeholderPng } from "./images/placeholder";
import type { ImageExtension } from "@/lib/uploads/sniff";

/**
 * AI image generation for posts. Routes depend on this interface only; pick
 * the implementation with IMAGE_PROVIDER ("mock" — the default — returns a
 * brand-coloured placeholder PNG without calling anything; "gemini" calls
 * Google's Gemini image model with GEMINI_API_KEY). Mirrors AI_PROVIDER /
 * INSTAGRAM_PROVIDER. Pure Gemini code lives in ./images (tested in tests/gemini).
 */

export type ImageProvider = "mock" | "gemini";

export interface ImageRequest {
  prompt: string;
  /** Brand colours, used by the mock placeholder. */
  colors: string[];
  /** Bump for a different result from the same prompt ("Regenerate"). */
  variant: number;
}

export interface GeneratedImage {
  data: Buffer;
  extension: ImageExtension;
  /** e.g. "mock" or the Gemini model id. */
  model: string;
}

export interface ImageService {
  readonly provider: ImageProvider;
  /** Throws ImageGenerationError when no image can be made (quota, billing, key, safety…). */
  generate(request: ImageRequest): Promise<GeneratedImage>;
}

export { ImageGenerationError, type ImageFailureReason };

/**
 * MOCK: a placeholder in the brand colours after a short pause. For testing the
 * error messages, a caption containing "[image-fail:<reason>]" (e.g.
 * "[image-fail:daily_limit]") fails with that reason.
 */
export class MockImageService implements ImageService {
  readonly provider = "mock" as const;

  async generate(request: ImageRequest): Promise<GeneratedImage> {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const forced = /\[image-fail:([a-z_]+)\]/.exec(request.prompt)?.[1];
    if (forced) {
      const reason = (IMAGE_FAILURE_REASONS as readonly string[]).includes(forced) ? (forced as ImageFailureReason) : "unavailable";
      throw new ImageGenerationError(reason, `Mock image failure requested (${reason}).`);
    }
    return { data: placeholderPng(request.colors, request.variant), extension: "png", model: "mock" };
  }
}

export class GeminiImageService implements ImageService {
  readonly provider = "gemini" as const;

  async generate(request: ImageRequest): Promise<GeneratedImage> {
    const config = readGeminiConfig();
    if (!config) throw new ImageGenerationError("not_configured", "GEMINI_API_KEY is not set.");
    return generateGeminiImage(config, request.prompt);
  }
}

export function imageProvider(): ImageProvider {
  const value = process.env.IMAGE_PROVIDER ?? "mock";
  if (value === "mock" || value === "gemini") return value;
  throw new Error(`Unknown IMAGE_PROVIDER "${value}".`);
}

let instance: ImageService | null = null;

export function getImageService(): ImageService {
  const provider = imageProvider();
  if (instance?.provider === provider) return instance;
  instance = provider === "gemini" ? new GeminiImageService() : new MockImageService();
  return instance;
}
