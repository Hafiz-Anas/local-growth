import { TextGenerationError } from "./errors";

/**
 * Onboarding's "Your style": the Gemini text model looks at up to 5 of the business's photos and
 * describes them as a text style guide (colour palette, camera angle, lighting, how close the
 * subject is, background and props, mood) plus one short line the owner sees and can edit. The
 * schema, the parser and the prompt line, pure (no server-only) so they can be unit-tested.
 */

export interface StyleGuideText {
  /** The one line shown to the owner, e.g. "Warm colors, close-up, top-down angle". */
  summary: string | null;
  palette: string | null;
  angle: string | null;
  lighting: string | null;
  closeness: string | null;
  background: string | null;
  mood: string | null;
}

export const STYLE_FIELDS = ["palette", "angle", "lighting", "closeness", "background", "mood"] as const;

export const STYLE_SUMMARY_MAX = 80;
const FIELD_MAX = 160;

export const STYLE_SCHEMA = {
  type: "OBJECT",
  properties: {
    summary: { type: "STRING", description: 'At most 8 words, comma-separated, e.g. "Warm colors, close-up, top-down angle".' },
    palette: { type: "STRING", description: "The colour palette: main colours and whether they are warm, cool, muted or bright." },
    angle: { type: "STRING", description: "Usual camera angle, e.g. top-down, eye level, 45 degrees." },
    lighting: { type: "STRING", description: "Light: natural daylight, soft, harsh, studio, dark and moody…" },
    closeness: { type: "STRING", description: "How close the subject is: close-up, medium, wide; how much of the frame it fills." },
    background: { type: "STRING", description: "Usual backgrounds, surfaces and props." },
    mood: { type: "STRING", description: "The overall mood or feeling in a few words." },
  },
  required: ["summary", "palette", "angle", "lighting", "closeness", "background", "mood"],
};

const tidy = (value: unknown, max: number): string | null => {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim().replace(/^["'“]+|["'”]+$/g, "");
  return text ? text.slice(0, max).trim() : null;
};

/** The model's JSON → a style guide. A guide without a summary or with no field filled in is no guide. */
export function parseStyleGuide(answer: string): StyleGuideText {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(answer.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as Record<string, unknown>;
  } catch {
    throw new TextGenerationError("bad_output", "The model's style guide wasn't valid JSON.", 200);
  }
  const guide: StyleGuideText = {
    summary: tidy(json.summary, STYLE_SUMMARY_MAX),
    palette: tidy(json.palette, FIELD_MAX),
    angle: tidy(json.angle, FIELD_MAX),
    lighting: tidy(json.lighting, FIELD_MAX),
    closeness: tidy(json.closeness, FIELD_MAX),
    background: tidy(json.background, FIELD_MAX),
    mood: tidy(json.mood, FIELD_MAX),
  };
  if (!guide.summary || STYLE_FIELDS.every((f) => !guide[f])) throw new TextGenerationError("bad_output", "The model's style guide was empty.", 200);
  return guide;
}

/** One prompt line: the owner's summary (it wins when they edited it) and the details. */
export function styleGuideLine(guide: StyleGuideText): string | null {
  const details = [
    guide.palette && `colours: ${guide.palette}`,
    guide.angle && `angle: ${guide.angle}`,
    guide.lighting && `lighting: ${guide.lighting}`,
    guide.closeness && `framing: ${guide.closeness}`,
    guide.background && `background and props: ${guide.background}`,
    guide.mood && `mood: ${guide.mood}`,
  ].filter(Boolean);
  if (!guide.summary && details.length === 0) return null;
  return [guide.summary, details.join("; ")].filter(Boolean).join(" — ");
}
