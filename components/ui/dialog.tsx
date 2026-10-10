"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  showClose = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { showClose?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/65" />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-[calc(100%-32px)] max-w-[400px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-panel bg-elevated text-foreground outline-none",
          className,
        )}
        {...props}
      >
        {children}
        {showClose && (
          <DialogPrimitive.Close className="absolute end-3 top-3 rounded-pill p-1 text-foreground hover:bg-hover" aria-label="Close">
            <X className="size-5" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("border-b border-separator px-4 py-3 text-center", className)} {...props} />;
}

export function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("text-title font-bold", className)} {...props} />;
}

export function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn("text-body text-muted", className)} {...props} />;
}

/** Instagram-style message sheet with a single dismiss action. */
export function InfoDialog({
  open,
  onOpenChange,
  title,
  description,
  actionLabel,
  icon,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  actionLabel: string;
  icon?: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showClose={false}>
        <div className="flex flex-col items-center px-8 pt-8 pb-5 text-center">
          {icon && (
            <span className="mb-4 flex size-20 items-center justify-center rounded-pill border-2 border-foreground [&_svg]:size-9">
              {icon}
            </span>
          )}
          <DialogTitle className="text-heading">{title}</DialogTitle>
          <DialogDescription className="mt-2">{description}</DialogDescription>
        </div>
        <DialogClose className="block min-h-12 w-full border-t border-separator text-body font-bold text-primary hover:bg-hover">
          {actionLabel}
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Instagram's confirmation sheet: centered title + body, then full-width
 * stacked actions separated by hairlines.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  destructive = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  destructive?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showClose={false} className="max-w-[400px]">
        <div className="px-8 pb-5 pt-8 text-center">
          <DialogTitle className="text-heading">{title}</DialogTitle>
          <DialogDescription className="mt-2">{description}</DialogDescription>
        </div>
        <button
          className={cn(
            "block min-h-12 w-full border-t border-separator text-body font-bold hover:bg-hover",
            destructive ? "text-danger" : "text-primary",
          )}
          onClick={() => {
            onConfirm();
            onOpenChange(false);
          }}
        >
          {confirmLabel}
        </button>
        <DialogClose className="block min-h-12 w-full border-t border-separator text-body hover:bg-hover">
          {cancelLabel}
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}
