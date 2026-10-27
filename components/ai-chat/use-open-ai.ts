"use client";

import { useRouter } from "next/navigation";
import { translate } from "@/lib/gallery/i18n";
import { useStore } from "@/lib/gallery/store";

/**
 * Opens the AI tab (the proposal's default layout; the footer banner opens the chat as a sheet instead).
 * With photos, starts a new chat with them attached and a ready prompt, so one tap sends.
 */
export function useOpenAi() {
  const router = useRouter();
  return (photoIds?: string[]) => {
    const s = useStore.getState();
    if (photoIds?.length) {
      s.newChat();
      s.setChatMode("post");
      s.setComposer({ photoIds, text: translate(s.lang, photoIds.length > 1 ? "photosPrompt" : "photoPrompt") });
    }
    s.closeViewer();
    s.setSelecting(false);
    s.closeSheet();
    router.push("/ai");
  };
}
