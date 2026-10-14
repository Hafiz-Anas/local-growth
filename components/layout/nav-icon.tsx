import {
  Activity,
  Bot,
  Compass,
  FileText,
  FlaskConical,
  House,
  Lightbulb,
  MessageCircle,
  Rocket,
  Settings,
  SquarePlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { NavIcon as NavIconName } from "@/config/navigation";
import { cn } from "@/lib/utils";

const ICONS: Record<NavIconName, LucideIcon> = {
  home: House,
  competitors: Compass,
  generator: SquarePlus,
  experiment: FlaskConical,
  engagement: MessageCircle,
  assistant: Bot,
  recommendations: Lightbulb,
  reports: FileText,
  settings: Settings,
  clients: Users,
  onboarding: Rocket,
  system: Activity,
};

/** 24px outline icon; the active item gets a heavier stroke, like Instagram's filled state. */
export function NavIcon({ name, active, className }: { name: NavIconName; active?: boolean; className?: string }) {
  const Icon = ICONS[name];
  return (
    <Icon
      className={cn("size-6 shrink-0 transition-transform group-hover:scale-105", name === "engagement" && "rtl:-scale-x-100", className)}
      strokeWidth={active ? 2.6 : 1.75}
      aria-hidden="true"
    />
  );
}
