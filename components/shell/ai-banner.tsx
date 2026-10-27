"use client";

import { ChevronRight, Sparkles } from "lucide-react";
import { useT } from "@/lib/gallery/hooks";
import { useStore } from "@/lib/gallery/store";

/** The footer AI entry point: above the tab bar on phones, centered at the bottom on desktop. */
export function AiBanner() {
  const { t } = useT();
  const openSheet = useStore((s) => s.openSheet);
  const hidden = useStore((s) => s.sheet?.type === "ai");
  const selecting = useStore((s) => s.selecting);
  if (selecting) return null;

  return (
    <div
      className="ge pointer-events-none fixed inset-x-0 bottom-[calc(52px+env(safe-area-inset-bottom))] z-30 px-3 pb-2 lg:start-[244px] lg:bottom-5 lg:flex lg:justify-center lg:px-8 lg:pb-0"
      aria-hidden={hidden}
    >
      <button
        type="button"
        onClick={() => openSheet({ type: "ai" })}
        data-testid="ai-banner"
        aria-haspopup="dialog"
        className="pointer-events-auto flex h-11 w-full items-center gap-2.5 rounded-full border bg-ge-elevated/95 ps-1.5 pe-2.5 text-start shadow-[0_6px_24px_-8px_rgb(0_0_0/0.25)] backdrop-blur-xl transition-transform active:scale-[0.99] lg:max-w-[560px]"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-ge-brand text-ge-primary-foreground">
          <Sparkles className="size-4" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] tracking-[-0.01em] text-ge-muted-foreground sm:text-[13.5px]">{t("aiBanner")}</span>
        <ChevronRight className="size-4 shrink-0 text-ge-muted-foreground max-sm:hidden rtl:rotate-180" />
      </button>
    </div>
  );
}
