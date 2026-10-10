"use client";

import * as React from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";

export const TooltipProvider = TooltipPrimitive.Provider;

/**
 * Compact dark tooltip. Pass `disabled` to render only the trigger
 * (e.g. sidebar labels are already visible when expanded).
 */
export function Tooltip({
  label,
  side = "right",
  disabled = false,
  children,
}: {
  label: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  disabled?: boolean;
  children: React.ReactElement;
}) {
  if (disabled) return children;
  return (
    <TooltipPrimitive.Root delayDuration={150}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={10}
          className="z-50 rounded-button bg-foreground px-2.5 py-1.5 text-caption font-semibold text-background shadow-menu"
        >
          {label}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
