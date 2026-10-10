import * as React from "react";
import { cn } from "@/lib/utils";

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "min-h-20 w-full resize-none rounded-button border border-border bg-input px-3 py-2 text-body text-foreground outline-none transition-colors placeholder:text-muted focus:border-muted",
        className,
      )}
      {...props}
    />
  );
}
