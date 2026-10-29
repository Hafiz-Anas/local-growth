"use client";

import { BarChart3, Clock, ImageIcon, Lightbulb, Send, Swords, TrendingUp, type LucideIcon } from "lucide-react";
import { translate, type MessageKey } from "@/lib/gallery/i18n";
import type { L } from "@/mock-data/gallery/types";

/**
 * The start screen's suggestions. Chats have no mode: the chat handles any topic. The id is a sample
 * answer (mock-data/gallery/ai-chat.ts) or one of the engine's flows (`x-…`, components/ai-chat/engine.ts).
 */
export type Prompt = { id: string; q: L; icon: LucideIcon };

const both = (key: MessageKey): L => ({ en: translate("en", key), ar: translate("ar", key) });

/** The three cards: shortcuts that send their question at once. */
export const SHORTCUTS: { id: string; key: MessageKey; icon: LucideIcon; prompt: Prompt }[] = [
  { id: "post", key: "aiModePost", icon: ImageIcon, prompt: { id: "x-latest", q: both("promptLatestPhoto"), icon: ImageIcon } },
  { id: "analytics", key: "aiModeAnalytics", icon: BarChart3, prompt: { id: "an-reach", q: both("promptWeek"), icon: TrendingUp } },
  { id: "competitors", key: "aiModeCompetitors", icon: Swords, prompt: { id: "co-compare", q: both("promptCompare"), icon: Swords } },
];

/** Suggested questions on every topic: under the cards, and as chips above the input in a chat. */
export const PROMPTS: Prompt[] = [
  { id: "post-next", q: both("promptTomorrow"), icon: Lightbulb },
  { id: "an-shared", q: both("promptMostShared"), icon: Send },
  { id: "co-working", q: both("promptWorking"), icon: TrendingUp },
  { id: "an-when", q: both("promptWhen"), icon: Clock },
];
