import "server-only";
import { DEFAULT_GEMINI_TEXT_RPM, readGeminiTextConfig } from "@/lib/services/text/gemini";

/**
 * Cron sweeps call the AI back to back; this spaces those calls to the per-minute budget
 * (GEMINI_TEXT_RPM) so a sweep doesn't run into its own rate limit and fall back. Per instance.
 */
let lastCall = 0;

export async function aiPace(): Promise<void> {
  const rpm = readGeminiTextConfig()?.rpm ?? DEFAULT_GEMINI_TEXT_RPM;
  const gap = Math.ceil(60_000 / rpm);
  const wait = lastCall + gap - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastCall = Date.now();
}
