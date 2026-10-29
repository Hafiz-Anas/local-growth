"use client";

import { BarChart3, Blend, CalendarDays, Clock, ImageIcon, ImagePlus, Layers, Lightbulb, Scale, Send, Swords, TrendingUp, Trophy, Wand2, type LucideIcon } from "lucide-react";
import { useT } from "@/lib/gallery/hooks";
import { translate, type MessageKey } from "@/lib/gallery/i18n";
import { cn } from "@/lib/gallery/utils";
import type { ChatMode } from "@/mock-data/gallery/ai-chat";
import type { L } from "@/mock-data/gallery/types";

/** The chat's three modes: the start screen's cards and the tag on each past chat. */
export const MODES: { mode: ChatMode; key: MessageKey; body: MessageKey; icon: LucideIcon }[] = [
  { mode: "post", key: "aiModePost", body: "aiModePostBody", icon: ImageIcon },
  { mode: "analytics", key: "aiModeAnalytics", body: "aiModeAnalyticsBody", icon: BarChart3 },
  { mode: "competitors", key: "aiModeCompetitors", body: "aiModeCompetitorsBody", icon: Swords },
];

export const modeInfo = (mode: ChatMode) => MODES.find((m) => m.mode === mode) ?? MODES[0];

export type Prompt = { id: string; q: L; icon: LucideIcon };

const both = (key: MessageKey): L => ({ en: translate("en", key), ar: translate("ar", key) });

/**
 * Suggested questions per mode. The id is a mock answer (mock-data/gallery/ai-chat.ts) or one of the
 * engine's flows (`x-…`, components/ai-chat/engine.ts).
 */
export const PROMPTS: Record<ChatMode, Prompt[]> = {
  post: [
    { id: "x-latest", q: both("promptLatestPhoto"), icon: ImagePlus },
    { id: "post-next", q: both("promptTomorrow"), icon: CalendarDays },
    { id: "x-combine", q: both("promptCombine"), icon: Blend },
    { id: "x-directions", q: both("promptDirections"), icon: Layers },
  ],
  analytics: [
    { id: "an-reach", q: both("promptWeek"), icon: TrendingUp },
    { id: "an-shared", q: both("promptMostShared"), icon: Send },
    { id: "an-best", q: both("promptBestMonth"), icon: Trophy },
    { id: "an-when", q: both("promptWhen"), icon: Clock },
  ],
  competitors: [
    { id: "co-working", q: both("promptWorking"), icon: Lightbulb },
    { id: "x-idea", q: both("promptTopIdea"), icon: Wand2 },
    { id: "co-compare", q: both("promptCompare"), icon: Scale },
    { id: "co-fastest", q: both("promptFastest"), icon: TrendingUp },
  ],
};

/** "Post" / "Analytics" / "Competitors" as a small tag. */
export function ModeTag({ mode, className }: { mode: ChatMode; className?: string }) {
  const { t } = useT();
  const m = modeInfo(mode);
  return (
    <span
      data-testid="chat-mode-tag"
      className={cn("inline-flex shrink-0 items-center gap-1 rounded-full bg-ge-brand-soft px-1.5 py-px text-[11px] font-semibold text-ge-brand-ink [&_svg]:size-3", className)}
    >
      <m.icon />
      {t(m.key)}
    </span>
  );
}
