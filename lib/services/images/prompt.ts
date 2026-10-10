/**
 * Builds the image prompt for a post from the brand profile, the caption and
 * the post's purpose. Pure so it can be unit-tested. The prompt is English
 * (image models follow it best) but quotes the caption as written.
 */

export interface ImagePromptInput {
  businessName: string;
  /** e.g. "bakery", or the business's own words for "other". */
  businessType: string | null;
  location: string | null;
  /** The brand profile summary, when one was built. */
  brandSummary: string | null;
  /** Visual style notes from the brand profile. */
  visualStyle: { summary: string; traits: string[] } | null;
  /** Brand colours (#rrggbb). */
  colors: string[];
  /** The post's purpose / occasion, e.g. "Menu item or product". */
  purpose: string;
  /** Product category, e.g. "Coffee beans". */
  product: string | null;
  caption: string;
}

const MAX_CAPTION = 400;
const MAX_PROMPT = 2000;

/** Caption text without hashtags, mentions, links and emojis — what the post is about. */
export function captionForPrompt(caption: string): string {
  const text = caption
    .replace(/https?:\/\/\S+|www\.\S+/g, " ")
    .replace(/[#@][\p{L}\p{N}_.]+/gu, " ")
    .replace(/\p{Extended_Pictographic}|️|‍/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > MAX_CAPTION ? `${text.slice(0, MAX_CAPTION).trimEnd()}…` : text;
}

export function buildImagePrompt(input: ImagePromptInput): string {
  const about = captionForPrompt(input.caption);
  const kind = input.businessType ? input.businessType.replace(/_/g, " ") : "local business";
  const place = input.location ? ` in ${input.location}` : "";
  const style = input.visualStyle;
  const lines = [
    `Create a square (1:1) Instagram feed photo for ${input.businessName}, a ${kind}${place}.`,
    `Purpose of the post: ${input.purpose}.${input.product ? ` Featured product: ${input.product}.` : ""}`,
    about ? `The post's caption (use it to decide what to show, do not write it in the image): "${about}"` : null,
    input.brandSummary ? `About the brand: ${input.brandSummary.trim()}` : null,
    style?.summary ? `Visual style: ${style.summary.trim()}` : null,
    style?.traits.length ? `Style notes: ${style.traits.slice(0, 6).join("; ")}.` : null,
    input.colors.length ? `Brand colours to echo in props, background or lighting: ${input.colors.slice(0, 5).join(", ")}.` : null,
    "Realistic, high-quality product photography with natural light and a clean composition that looks good in an Instagram feed.",
    "Do not include any text, letters, numbers, prices, logos, watermarks or brand names in the image. No people's faces.",
  ].filter((line): line is string => Boolean(line));
  const prompt = lines.join("\n");
  return prompt.length > MAX_PROMPT ? prompt.slice(0, MAX_PROMPT) : prompt;
}
