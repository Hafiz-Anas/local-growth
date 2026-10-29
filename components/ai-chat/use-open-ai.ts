"use client";

import { useRouter } from "next/navigation";
import type { CompetitorPostRef } from "@/lib/gallery/competitor-posts";
import { translate } from "@/lib/gallery/i18n";
import { useStore } from "@/lib/gallery/store";

/**
 * Opens the AI tab, the only way into the chat.
 * With photos, starts a new chat with them attached and a ready prompt, so one tap sends.
 * With a competitor's post ("Create a similar post"), starts a new chat with it attached as a reference.
 */
export function useOpenAi() {
  const router = useRouter();
  return (photoIds?: string[], reference?: CompetitorPostRef) => {
    const s = useStore.getState();
    if (reference) {
      s.newChat();
      s.setComposer({ photoIds: [], reference, text: translate(s.lang, "similarPrompt", { handle: reference.handle }) });
    } else if (photoIds?.length) {
      s.newChat();
      s.setComposer({ photoIds, text: translate(s.lang, photoIds.length > 1 ? "photosPrompt" : "photoPrompt") });
    }
    s.closeViewer();
    s.setSelecting(false);
    s.closeSheet();
    router.push("/ai");
  };
}
