"use client";

import * as React from "react";
import { Tabs as TabsPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;

/** Instagram-style tab row: equal tabs on a hairline, active one gets a 1px foreground underline. */
export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List className={cn("flex items-stretch gap-8 border-b border-border", className)} {...props} />
  );
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "-mb-px flex h-12 items-center gap-1.5 border-b border-transparent text-caption font-semibold tracking-wide text-muted uppercase transition-colors outline-none",
        "data-[state=active]:border-foreground data-[state=active]:text-foreground [&_svg]:size-3",
        className,
      )}
      {...props}
    />
  );
}

export const TabsContent = TabsPrimitive.Content;
