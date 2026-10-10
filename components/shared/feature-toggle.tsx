"use client";

import { useId } from "react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/** Settings-style row: label + hint on the start side, Instagram toggle on the end. */
export function FeatureToggle({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
  nested = false,
  className,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Indented sub-feature row. */
  nested?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn("flex items-center justify-between gap-4 py-3", nested && "ps-4", className)}>
      <label htmlFor={id} className={cn("min-w-0 flex-1 cursor-pointer", disabled && "cursor-default")}>
        <span className={cn("block text-body", nested ? "font-normal" : "font-semibold")}>{label}</span>
        {description && <span className="mt-0.5 block text-caption text-muted">{description}</span>}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  );
}
