import { TextGenerationError } from "./errors";

/**
 * Onboarding's competitor suggestions, the pure parts: the answer's schema and the parser that keeps
 * only well-formed Instagram usernames (never the business itself or accounts already listed). The
 * model may misremember accounts, so every suggestion is still checked with Instagram before it is
 * shown (lib/server/competitor-suggestions.ts). Pure (no server-only) so it can be unit-tested.
 */

export const MAX_SUGGESTION_CANDIDATES = 8;

export const SUGGEST_SCHEMA = {
  type: "OBJECT",
  properties: {
    handles: { type: "ARRAY", items: { type: "STRING" }, description: "Up to 8 Instagram usernames of similar local businesses in Kuwait, without @." },
  },
  required: ["handles"],
};

const HANDLE = /^[a-z0-9._]{1,30}$/;

export function parseSuggestedHandles(answer: string, exclude: string[] = []): string[] {
  let json: { handles?: unknown };
  try {
    json = JSON.parse(answer.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as { handles?: unknown };
  } catch {
    throw new TextGenerationError("bad_output", "The model's suggestions weren't valid JSON.", 200);
  }
  const skip = new Set(exclude.map((h) => h.toLowerCase()));
  const handles = (Array.isArray(json.handles) ? json.handles : [])
    .filter((h): h is string => typeof h === "string")
    .map((h) => h.trim().replace(/^@+/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/.*$/, "").toLowerCase())
    .filter((h) => HANDLE.test(h) && !h.startsWith(".") && !h.endsWith(".") && !skip.has(h));
  return [...new Set(handles)].slice(0, MAX_SUGGESTION_CANDIDATES);
}
