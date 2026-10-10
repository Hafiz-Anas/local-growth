import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, type = "text", ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-button border border-border bg-input px-3 text-body text-foreground outline-none transition-colors placeholder:text-muted focus:border-muted disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
