"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertCircle, Camera, CheckCircle2, X } from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { useUiStore, type Toast } from "@/store/ui-store";

/** Renders toasts and the Instagram-required prompt. Mounted once in AppProviders. */
export function Feedback() {
  return (
    <>
      <Toaster />
      <InstagramRequiredDialog />
    </>
  );
}

/** Instagram's snackbar: a dark rounded bar at the bottom centre, above the mobile tab bar. */
function Toaster() {
  const toasts = useUiStore((s) => s.toasts);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--tabbar-height)+16px)] z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useUiStore((s) => s.dismissToast);
  const { t } = useI18n();
  useEffect(() => {
    const id = setTimeout(() => dismiss(toast.id), toast.tone === "error" ? 6000 : 3500);
    return () => clearTimeout(id);
  }, [dismiss, toast.id, toast.tone]);

  const Icon = toast.tone === "error" ? AlertCircle : toast.tone === "success" ? CheckCircle2 : null;
  return (
    <div
      role={toast.tone === "error" ? "alert" : "status"}
      className="pointer-events-auto flex w-full max-w-[420px] items-center gap-3 animate-toast-in rounded-card bg-snackbar px-4 py-3 text-body text-white shadow-lg"
    >
      {Icon && <Icon className={cn("size-5 shrink-0", toast.tone === "error" ? "text-snackbar-error" : "text-snackbar-success")} aria-hidden="true" />}
      <p className="min-w-0 flex-1">{toast.message}</p>
      {toast.action && (
        <Link href={toast.action.href} onClick={() => dismiss(toast.id)} className="shrink-0 font-semibold text-snackbar-link hover:text-white">
          {toast.action.label}
        </Link>
      )}
      <button type="button" onClick={() => dismiss(toast.id)} className="shrink-0 rounded-pill p-0.5 text-white/70 hover:text-white" aria-label={t("common.dismiss")}>
        <X className="size-4" />
      </button>
    </div>
  );
}

/** Shown whenever an action fails with `instagram_not_connected`. */
function InstagramRequiredDialog() {
  const message = useUiStore((s) => s.instagramPrompt);
  const close = useUiStore((s) => s.setInstagramPrompt);
  const pathname = usePathname();
  const { t } = useI18n();
  // Admins (previewing) can't connect a client's account; send them nowhere.
  const canConnect = !pathname.startsWith("/admin");

  return (
    <Dialog open={message !== null} onOpenChange={(open) => !open && close(null)}>
      <DialogContent showClose={false} className="max-w-[400px]">
        <div className="flex flex-col items-center px-8 pt-8 pb-5 text-center">
          <span className="mb-4 flex size-20 items-center justify-center rounded-pill border-2 border-foreground [&_svg]:size-9">
            <Camera strokeWidth={1.5} />
          </span>
          <DialogTitle className="text-heading">{t("instagramPrompt.title")}</DialogTitle>
          <DialogDescription className="mt-2">{message}</DialogDescription>
        </div>
        {canConnect && (
          <Link
            href="/settings#instagram"
            onClick={() => close(null)}
            className="block min-h-12 w-full border-t border-separator py-3.5 text-center text-body font-bold text-primary hover:bg-hover"
          >
            {t("instagramPrompt.connect")}
          </Link>
        )}
        <DialogClose className="block min-h-12 w-full border-t border-separator text-body hover:bg-hover">{t("instagramPrompt.notNow")}</DialogClose>
      </DialogContent>
    </Dialog>
  );
}
