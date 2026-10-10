import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        /** Instagram blue — primary actions (Log in, Follow, Approve). */
        primary: "bg-primary text-on-primary hover:bg-primary-hover",
        /** Gray — secondary actions (Edit profile, Message). */
        secondary: "bg-button-secondary text-foreground hover:bg-button-secondary-hover",
        /** Blue text only — inline actions like "Reply", "See all". */
        link: "text-primary hover:text-link px-0",
        /** Muted text only. */
        ghost: "text-foreground hover:bg-hover",
        danger: "text-danger hover:bg-hover",
        /** Pill outline for chips / filters. */
        outline: "border border-border bg-background text-foreground hover:bg-hover",
      },
      size: {
        sm: "h-8 rounded-button px-4 text-body",
        md: "h-9 rounded-button px-4 text-body",
        lg: "h-11 rounded-button px-5 text-body",
        pill: "h-8 rounded-pill px-3 text-body",
        icon: "size-9 rounded-button [&_svg]:size-6",
        "icon-sm": "size-8 rounded-button [&_svg]:size-5",
      },
    },
    compoundVariants: [{ variant: "link", className: "h-auto px-0" }],
    defaultVariants: { variant: "primary", size: "sm" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, type = "button", ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="button"
      type={asChild ? undefined : type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { buttonVariants };
