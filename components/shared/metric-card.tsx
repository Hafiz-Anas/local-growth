import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ChangeIndicator } from "./change-indicator";

/** Headline number with period-over-period change (Instagram Insights style). */
export function MetricCard({
  label,
  value,
  changePct,
  hint,
  unavailable,
  className,
}: {
  label: string;
  value: ReactNode;
  changePct?: number;
  hint?: string;
  /** Instagram has no data for this metric yet: shows `unavailable` text instead of a number. */
  unavailable?: string;
  className?: string;
}) {
  if (unavailable) {
    return (
      <div className={cn("rounded-card border border-border bg-background p-4", className)}>
        <p className="text-caption text-muted">{label}</p>
        <p className="mt-1.5 text-heading font-bold text-muted">—</p>
        <p className="mt-1 text-caption text-muted">{unavailable}</p>
      </div>
    );
  }
  return (
    <div className={cn("rounded-card border border-border bg-background p-4", className)}>
      <p className="text-caption text-muted">{label}</p>
      <p className="mt-1.5 text-heading font-bold tabular-nums">
        <span dir="ltr">{value}</span>
      </p>
      {(changePct !== undefined || hint) && (
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {changePct !== undefined && <ChangeIndicator value={changePct} />}
          {hint && <span className="text-caption text-muted">{hint}</span>}
        </div>
      )}
    </div>
  );
}
