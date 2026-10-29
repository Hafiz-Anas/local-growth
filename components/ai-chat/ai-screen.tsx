"use client";

import { PanelLeft, Sparkles, SquarePen } from "lucide-react";
import { useState } from "react";
import { IconBtn } from "@/components/gallery/kit";
import { useIsDesktop, useT } from "@/lib/gallery/hooks";
import { useActiveChat, useStore } from "@/lib/gallery/store";
import { HeaderActions } from "@/components/shell/header-actions";
import { CLIENT_FIXED_START } from "@/components/layout/sidebar";
import { ChatView } from "./chat-view";

/** The AI tab: a full-screen chat between the header and the tab bar (or beside the sidebar, below the header, on desktop). */
export function AiScreen() {
  const { t, l } = useT();
  const isDesktop = useIsDesktop();
  const chat = useActiveChat();
  const [list, setList] = useState(false);

  return (
    <div className={`fixed inset-x-0 top-0 bottom-[calc(53px+env(safe-area-inset-bottom))] z-20 flex flex-col bg-ge-background pt-safe lg:top-(--topbar-height) lg:bottom-0 ${CLIENT_FIXED_START}`}>
      <header className="flex h-14 shrink-0 items-center gap-1 px-2 lg:hidden">
        <IconBtn label={t("chats")} onClick={() => setList((open) => !open)}>
          <PanelLeft strokeWidth={1.8} className="rtl:-scale-x-100" />
        </IconBtn>
        <h1 className="flex min-w-0 flex-1 items-center gap-1.5 px-1 text-[16px] font-semibold">
          {chat ? (
            <>
              <span className="truncate" dir="auto">
                {l(chat.title)}
              </span>
            </>
          ) : (
            <>
              <Sparkles className="size-4 shrink-0 text-ge-brand" /> {t("aiTab")}
            </>
          )}
        </h1>
        {chat && (
          <IconBtn label={t("newChat")} onClick={() => useStore.getState().newChat()}>
            <SquarePen strokeWidth={1.8} />
          </IconBtn>
        )}
        <HeaderActions />
      </header>
      <h1 className="sr-only max-lg:hidden">{t("aiTab")}</h1>
      <div className="flex min-h-0 flex-1">
        <ChatView sidebar={isDesktop} listOpen={list} onListOpenChange={setList} />
      </div>
    </div>
  );
}
