import { ChartNoAxesColumn, Images, MessageCircle, Settings, Sparkles, Swords, type LucideIcon } from "lucide-react";
import type { NavIcon } from "@/config/navigation";

/** The proposal's navigation icons, by the section's icon name in config/navigation.ts. */
export const SECTION_ICONS: Partial<Record<NavIcon, LucideIcon>> = {
  gallery: Images,
  engagement: MessageCircle,
  ai: Sparkles,
  insights: ChartNoAxesColumn,
  competitors: Swords,
  settings: Settings,
};

/** The Gallery is the home page (only matched exactly, like the proposal's "/"). */
export const HOME_HREF = "/gallery";
