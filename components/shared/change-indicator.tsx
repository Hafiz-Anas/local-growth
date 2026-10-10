import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn, formatPct } from "@/lib/utils";

/** Up/down change with an arrow — never colour alone. */
export function ChangeIndicator({ value, className }: { value: number; className?: string }) {
  const up = value >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn("inline-flex items-center gap-0.5 text-caption font-semibold", up ? "text-success" : "text-danger", className)}
      dir="ltr"
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {formatPct(value, { signed: true })}
    </span>
  );
}
