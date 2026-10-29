import {
  Activity,
  BarChart3,
  Compass,
  FileText,
  FlaskConical,
  House,
  Images,
  Lightbulb,
  MessageCircle,
  Rocket,
  Settings,
  Sparkles,
  SquarePlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { NavIcon as NavIconName } from "@/config/navigation";
import { cn } from "@/lib/utils";

/** The only icon map: the sidebar, both phone tab bars and the profile menu all draw through NavIcon. */
const ICONS: Record<NavIconName, LucideIcon> = {
  home: House,
  gallery: Images,
  ai: Sparkles,
  competitors: Compass,
  generator: SquarePlus,
  experiment: FlaskConical,
  engagement: MessageCircle,
  recommendations: Lightbulb,
  reports: FileText,
  insights: BarChart3,
  settings: Settings,
  clients: Users,
  onboarding: Rocket,
  system: Activity,
};

/** 24px outline icon; the active item gets a heavier stroke, like Instagram's filled state. */
export function NavIcon({
  name,
  active,
  className,
  strokeWidth,
}: {
  name: NavIconName;
  active?: boolean;
  className?: string;
  /** Overrides the default weight (the phone tab bar's gradient AI pill draws a little bolder). */
  strokeWidth?: number;
}) {
  const Icon = ICONS[name];
  return (
    <Icon
      className={cn("size-6 shrink-0 transition-transform group-hover:scale-105", name === "engagement" && "rtl:-scale-x-100", className)}
      strokeWidth={strokeWidth ?? (active ? 2.6 : 1.75)}
      aria-hidden="true"
    />
  );
}
