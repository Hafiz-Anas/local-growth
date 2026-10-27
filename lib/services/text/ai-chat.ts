import { isArabic } from "./output";

/**
 * The AI tab's free-typed questions (components/ai-chat). The chat itself runs on the design
 * proposal's mock data in the browser; only a question none of its suggested answers matches is
 * sent here, for a short general reply. Pure (no server-only) so it can be unit-tested.
 */

export const AI_CHAT_MODES = ["post", "analytics", "competitors"] as const;
export type AiChatMode = (typeof AI_CHAT_MODES)[number];
export const AI_CHAT_MAX_QUESTION = 500;

/** The answer follows the question: any Arabic letter → Arabic. */
export const questionLanguage = (text: string): "en" | "ar" => (isArabic(text) ? "ar" : "en");

/** The model's answer as plain text: no markdown emphasis or headings, "- " bullets. */
export function cleanChatAnswer(answer: string): string {
  return answer
    .replace(/\r\n/g, "\n")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[*•]\s+/gm, "- ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
