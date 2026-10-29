"use client";

import { AnimatePresence, motion } from "framer-motion";
import { MoreHorizontal, PencilLine, SquarePen, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useActiveClient } from "@/components/providers/active-client-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/gallery/dropdown-menu";
import { Btn, IconBtn } from "@/components/gallery/kit";
import { Sheet } from "@/components/gallery/sheet";
import { useBackHandler } from "@/lib/gallery/back";
import { useT } from "@/lib/gallery/hooks";
import type { MessageKey } from "@/lib/gallery/i18n";
import { groupChats, type ChatGroup } from "@/lib/gallery/saved-chats";
import { useChats, useStore } from "@/lib/gallery/store";
import { cn } from "@/lib/gallery/utils";
import type { AiChat } from "@/mock-data/gallery/ai-studio";

const GROUP_LABEL: Record<ChatGroup, MessageKey> = {
  today: "today",
  yesterday: "chatsYesterday",
  earlier: "chatsEarlier",
};

/** A chat being renamed or about to be deleted. */
export type ChatEdit = { type: "rename" | "delete"; chat: AiChat } | null;

/**
 * "New chat", then past chats by Today / Yesterday / Earlier, each with a Rename / Delete menu.
 * Admin preview is read-only, also for these browser-saved chats: no menu.
 */
export function ChatList({
  onPick,
  onEdit,
}: {
  onPick: () => void;
  onEdit: (edit: ChatEdit) => void;
}) {
  const { t, l } = useT();
  const { isPreview } = useActiveClient();
  const chats = useChats();
  const activeId = useStore((s) => s.activeChatId);
  const groups = useMemo(() => groupChats(chats, new Date()), [chats]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="p-2">
        <button
          type="button"
          onClick={() => {
            useStore.getState().newChat();
            onPick();
          }}
          className="flex h-11 w-full items-center gap-3 rounded-xl px-3 text-[14px] font-semibold hover:bg-ge-muted"
        >
          <SquarePen className="size-5" />
          {t("newChat")}
        </button>
      </div>
      <nav
        aria-label={t("chats")}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto px-2 pb-4"
      >
        {groups.length === 0 && (
          <p className="px-3 py-2 text-[13px] text-ge-muted-foreground">
            {t("noChats")}
          </p>
        )}
        {groups.map((g) => (
          <section key={g.group} aria-label={t(GROUP_LABEL[g.group])}>
            <h3 className="px-3 pb-1 text-[12px] font-semibold text-ge-muted-foreground">
              {t(GROUP_LABEL[g.group])}
            </h3>
            <ul>
              {g.chats.map((c) => (
                <li key={c.id} className="relative" data-testid="chat-item">
                  <button
                    type="button"
                    aria-current={c.id === activeId ? "true" : undefined}
                    onClick={() => {
                      useStore.getState().openChat(c.id);
                      onPick();
                    }}
                    className={cn(
                      "flex w-full flex-col items-start gap-1 rounded-xl py-2 ps-3 text-start hover:bg-ge-muted",
                      isPreview ? "pe-3" : "pe-11",
                      c.id === activeId && "bg-ge-muted",
                    )}
                  >
                    <span
                      className={cn(
                        "w-full truncate text-[14px]",
                        c.id === activeId && "font-semibold",
                      )}
                      dir="auto"
                    >
                      {l(c.title)}
                    </span>
                  </button>
                  {!isPreview && (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        aria-label={`${t("chatOptions")}: ${l(c.title)}`}
                        className="absolute end-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-ge-muted-foreground hover:bg-ge-secondary hover:text-ge-foreground data-popup-open:bg-ge-secondary"
                      >
                        <MoreHorizontal className="size-[18px]" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        className="w-auto min-w-36"
                      >
                        <DropdownMenuItem
                          onClick={() => onEdit({ type: "rename", chat: c })}
                        >
                          <PencilLine /> {t("renameChat")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => onEdit({ type: "delete", chat: c })}
                        >
                          <Trash2 /> {t("deleteChat")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </nav>
    </div>
  );
}

/** Phones: the chat list slides in from the start edge. */
export function ChatListDrawer({
  open,
  onClose,
  onEdit,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  onEdit: (edit: ChatEdit) => void;
  editing: boolean;
}) {
  const { t, dir } = useT();
  const side = dir === "rtl" ? "100%" : "-100%";
  useBackHandler(open, onClose);
  useEffect(() => {
    // While renaming or deleting, Escape belongs to that sheet.
    if (!open || editing) return;
    const onKey = (e: KeyboardEvent) =>
      e.key === "Escape" && (e.stopPropagation(), onClose());
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, editing, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <div className="absolute inset-0 z-30">
          <motion.div
            className="absolute inset-0 bg-black/35"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-label={t("chats")}
            className="absolute inset-y-0 start-0 flex w-[82%] max-w-[320px] flex-col border-e bg-ge-elevated shadow-2xl"
            initial={{ x: side }}
            animate={{ x: 0 }}
            exit={{ x: side }}
            transition={{ type: "spring", damping: 34, stiffness: 360 }}
          >
            <div className="flex h-12 items-center justify-between ps-4 pe-1.5">
              <h2 className="text-[15px] font-semibold">{t("chats")}</h2>
              <IconBtn
                label={t("close")}
                onClick={onClose}
                className="size-9 [&_svg]:size-5"
              >
                <X />
              </IconBtn>
            </div>
            <ChatList onPick={onClose} onEdit={onEdit} />
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/** Rename (name field) or Delete (confirmation) for one chat. */
export function ChatEditSheets({
  edit,
  onClose,
}: {
  edit: ChatEdit;
  onClose: () => void;
}) {
  const { t, l } = useT();
  const [name, setName] = useState("");
  // Start from the chat's current name each time Rename opens.
  const [renaming, setRenaming] = useState<string | null>(null);
  const renameId = edit?.type === "rename" ? edit.chat.id : null;
  if (renameId !== renaming) {
    setRenaming(renameId);
    if (edit?.type === "rename") setName(l(edit.chat.title));
  }

  const rename = () => {
    const n = name.trim();
    if (!n || edit?.type !== "rename") return;
    useStore.getState().renameChat(edit.chat.id, n);
    toast.success(t("chatRenamed"));
    onClose();
  };
  // The last chat shown, so the delete sheet keeps its title while it closes.
  const [shown, setShown] = useState(edit);
  if (edit && edit !== shown) setShown(edit);

  const remove = () => {
    if (edit?.type !== "delete") return;
    useStore.getState().deleteChat(edit.chat.id);
    toast.success(t("chatDeleted"));
    onClose();
  };

  return (
    <>
      <Sheet
        open={edit?.type === "rename"}
        onClose={onClose}
        title={t("renameChatTitle")}
        footer={
          <Btn
            size="lg"
            className="w-full"
            disabled={!name.trim()}
            onClick={rename}
          >
            {t("save")}
          </Btn>
        }
      >
        <form
          className="px-4 pb-4"
          onSubmit={(e) => {
            e.preventDefault();
            rename();
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("chatName")}
            aria-label={t("chatName")}
            maxLength={80}
            autoFocus
            dir="auto"
            className="h-12 w-full rounded-xl bg-ge-muted px-3 text-[16px] outline-none focus-visible:ring-2 focus-visible:ring-ge-ring"
          />
        </form>
      </Sheet>
      <Sheet
        open={edit?.type === "delete"}
        onClose={onClose}
        title={t("deleteChatTitle")}
        footer={
          <div className="flex gap-2">
            <Btn
              size="lg"
              variant="secondary"
              className="flex-1"
              onClick={onClose}
            >
              {t("cancel")}
            </Btn>
            <Btn size="lg" variant="danger" className="flex-1" onClick={remove}>
              {t("deleteChat")}
            </Btn>
          </div>
        }
      >
        <p className="px-4 pb-4 text-[14px] text-ge-muted-foreground">
          {t("deleteChatBody", { title: shown ? l(shown.chat.title) : "" })}
        </p>
      </Sheet>
    </>
  );
}
