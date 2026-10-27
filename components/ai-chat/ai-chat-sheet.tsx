"use client";

import { History, Sparkles, SquarePen } from "lucide-react";
import { useState } from "react";
import { IconBtn } from "@/components/gallery/kit";
import { Sheet } from "@/components/gallery/sheet";
import { useSheet } from "@/components/gallery/sheets/use-sheet";
import { useT } from "@/lib/gallery/hooks";
import { useStore } from "@/lib/gallery/store";
import { ChatView } from "./chat-view";

/** "Footer pop-up" demo layout: the footer bar opens the full chat as a full-height sheet. */
export function AiChatSheet() {
  const { open, close } = useSheet("ai");
  const { t } = useT();
  const [history, setHistory] = useState(false);

  return (
    <Sheet
      open={open}
      onClose={() => (setHistory(false), close())}
      desktop="panel"
      tall
      wide
      title={
        <span className="inline-flex items-center gap-1.5">
          <Sparkles className="size-4 text-ge-brand" /> {t("aiTab")}
        </span>
      }
      start={
        <IconBtn label={t("chats")} onClick={() => setHistory((h) => !h)} className="size-9 [&_svg]:size-5">
          <History />
        </IconBtn>
      }
      end={
        <IconBtn label={t("newChat")} onClick={() => (useStore.getState().newChat(), setHistory(false))} className="size-9 [&_svg]:size-5">
          <SquarePen />
        </IconBtn>
      }
      bodyClassName="flex flex-col"
    >
      <ChatView sidebar={false} historyOpen={history} onHistoryOpenChange={setHistory} />
    </Sheet>
  );
}
