"use client";

import { Dialog as DialogPrimitive } from "radix-ui";
import { Send, Sparkles, X } from "lucide-react";
import { create } from "zustand";
import { useActiveClient, useFeature } from "@/components/providers/active-client-provider";
import { CONTENT_INSET } from "@/components/layout/profile-menu";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { AssistantChat } from "./assistant-chat";

/** Whether the assistant panel is open; anything can open it (the banner, the AI status card…). */
export const useAssistantPanel = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({ open: false, setOpen: (open) => set({ open }) }));

/** True when the footer banner shows (the assistant is on for this client, and it isn't an admin preview). */
export function useAssistantBanner(): boolean {
  const { isPreview } = useActiveClient();
  return useFeature("assistant") && !isPreview;
}

/**
 * The AI assistant's entry point: a text bar fixed at the bottom of the client area —
 * full width above the tab bar on phones, a centred pill on wider screens. Tapping it opens
 * the chat sliding up from the bottom (full screen on phones, a panel on desktop). The chat
 * itself is AssistantChat, unchanged: modes, history, languages, limits and grounding.
 */
export function AssistantBanner() {
  const { t } = useI18n();
  const show = useAssistantBanner();
  const open = useAssistantPanel((s) => s.open);
  const setOpen = useAssistantPanel((s) => s.setOpen);
  if (!show) return null;

  return (
    <>
      <div className={cn("pointer-events-none fixed inset-x-0 bottom-(--tabbar-height) z-30 md:bottom-0", CONTENT_INSET)}>
        <div className="pointer-events-auto border-t border-border bg-background px-3 py-2 md:mx-auto md:mb-4 md:max-w-xl md:border-t-0 md:bg-transparent md:px-0 md:py-0">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={open}
            data-testid="assistant-banner"
            className="flex h-12 w-full items-center gap-3 rounded-pill border border-border bg-input px-4 text-start text-body text-muted shadow-sm transition-colors hover:border-muted md:shadow-lg"
          >
            <Sparkles className="size-5 shrink-0 text-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{t("assistant.bannerPlaceholder")}</span>
            <Send className="size-5 shrink-0 text-primary rtl:-scale-x-100" aria-hidden="true" />
          </button>
        </div>
      </div>

      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 hidden bg-black/50 md:block" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            data-testid="assistant-panel"
            className={cn(
              "fixed inset-0 z-50 flex animate-sheet-up flex-col bg-background outline-none",
              "md:inset-auto md:bottom-4 md:left-1/2 md:h-[min(85dvh,760px)] md:w-[min(720px,calc(100vw-2rem))] md:-translate-x-1/2 md:overflow-hidden md:rounded-panel md:border md:border-border md:shadow-2xl",
            )}
          >
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <Sparkles className="size-5 shrink-0" aria-hidden="true" />
              <DialogPrimitive.Title className="flex-1 text-title font-bold">{t("assistant.title")}</DialogPrimitive.Title>
              <DialogPrimitive.Close className="rounded-pill p-1.5 text-foreground hover:bg-hover" aria-label={t("assistant.close")}>
                <X className="size-5" aria-hidden="true" />
              </DialogPrimitive.Close>
            </div>
            <AssistantChat className="min-h-0 flex-1 rounded-none border-0" />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}
