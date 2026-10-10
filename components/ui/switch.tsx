"use client";

import * as React from "react";
import { Switch as SwitchPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

/** Instagram-style toggle: foreground-colored track when on, neutral when off. */
export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-6 w-10 shrink-0 items-center rounded-pill p-0.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50",
        "bg-border data-[state=checked]:bg-foreground",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block size-5 rounded-pill bg-background shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition-transform",
          "data-[state=unchecked]:translate-x-0 data-[state=checked]:translate-x-4",
          "rtl:data-[state=checked]:-translate-x-4",
        )}
      />
    </SwitchPrimitive.Root>
  );
}
