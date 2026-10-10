"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Pill choices in the Post Generator's style (selected = solid). Single choice
 * by default; `multiple` toggles values in and out of `value`.
 */
export function ChipSelect<T extends string>({
  label,
  hint,
  options,
  value,
  onChange,
  invalid,
  className,
  size = "md",
}: {
  label?: string;
  hint?: string;
  options: Array<{ value: T; label: string; icon?: ReactNode }>;
  value: T | null;
  onChange: (value: T) => void;
  invalid?: boolean;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <fieldset className={className} aria-invalid={invalid || undefined}>
      {label && <legend className="mb-1 text-body font-semibold">{label}</legend>}
      {hint && <p className="mb-2.5 text-caption text-muted">{hint}</p>}
      <div className={cn("flex flex-wrap gap-2", !hint && label && "mt-1.5")} role="radiogroup">
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(o.value)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-button px-3 font-semibold transition-colors [&_svg]:size-4",
                size === "sm" ? "h-7 text-caption" : "h-8 text-body",
                selected ? "bg-foreground text-background" : "bg-button-secondary text-foreground hover:bg-button-secondary-hover",
                invalid && !selected && "ring-1 ring-danger/60",
              )}
            >
              {o.icon}
              {o.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
