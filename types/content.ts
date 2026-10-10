import type { MediaIcon } from "./dashboard";
import type { MediaTone } from "./client";

export interface ProductCategory {
  id: string;
  label: string;
  labelAr: string;
  productNames: string[];
  icon: MediaIcon;
  tone: MediaTone;
}

export interface Occasion {
  id: string;
  label: string;
  labelAr: string;
}

export interface CaptionTemplate {
  id: string;
  /** Occasion this template fits, or "*" for any. */
  occasionId: string;
  language: "en" | "ar";
  /** Supports {product}, {word} and {handle} placeholders. */
  text: string;
  hashtags: string[];
}

export interface PostGeneratorData {
  categories: ProductCategory[];
  occasions: Occasion[];
  brandVocabulary: string[];
  templates: CaptionTemplate[];
}

export type PostWindow = "morning" | "afternoon" | "evening";

export interface ScheduledPost {
  id: string;
  caption: string;
  tone: MediaTone;
  icon: MediaIcon;
  scheduledFor: string; // ISO datetime
  window: PostWindow;
  source: "generator" | "manual";
}
