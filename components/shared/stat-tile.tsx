import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Compact icon + number tile for counts and quick status. */
export function StatTile({
  icon: Icon,
  label,
  value,
  action,
  accent = false,
  className,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  action?: ReactNode;
  /** Gradient icon chip for the one tile that deserves attention. */
  accent?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3 rounded-card border border-border bg-background p-3", className)}>
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-pill",
          accent ? "bg-ig-gradient text-white" : "bg-button-secondary text-foreground",
        )}
      >
        <Icon className="size-5" strokeWidth={1.75} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-title font-bold tabular-nums">{value}</p>
        <p className="line-clamp-2 text-caption text-muted">{label}</p>
      </div>
      {action}
    </div>
  );
}
