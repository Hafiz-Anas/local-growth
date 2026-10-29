"use client";

import { ArrowUp, Eye, Plus, Sparkles, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Chip, IconBtn } from "@/components/gallery/kit";
import { useActiveClient } from "@/components/providers/active-client-provider";
import { PhotoImage } from "@/components/gallery/photo-image";
import { useT } from "@/lib/gallery/hooks";
import { translate } from "@/lib/gallery/i18n";
import { useActiveChat, useStore } from "@/lib/gallery/store";
import { findCategory } from "@/mock-data/gallery/categories";
import { ChatEditSheets, ChatList, ChatListDrawer, type ChatEdit } from "./chat-list";
import { useAiEngine, useChatContext, type AiEngine } from "./engine";
import { AnswerMessage, DirectionsMessage, InspirationMessage, PostMessage, ProductMessage, ReferenceThumb, TextMessage, TypingDots, UserMessage } from "./messages";
import { PROMPTS, SHORTCUTS, type Prompt } from "./modes";
import { PhotoPicker } from "./photo-picker";

/**
 * The AI chat: the start screen (three shortcut cards and suggested questions) or the open chat, the
 * composer with photo attachments, and past chats — in a column on desktop (`sidebar`), else a drawer.
 */
export function ChatView({ sidebar, listOpen, onListOpenChange }: { sidebar: boolean; listOpen: boolean; onListOpenChange: (open: boolean) => void }) {
  const ctx = useChatContext();
  const engine = useAiEngine(ctx);
  // "combine" asks for 2–4 photos and fills in a combine prompt; "attach" is the plain "+".
  const [picker, setPicker] = useState<"attach" | "combine" | null>(null);
  const [edit, setEdit] = useState<ChatEdit>(null);
  const composer = useStore((s) => s.composer);

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1">
      {sidebar && (
        <aside className="flex w-[260px] shrink-0 flex-col border-e">
          <ChatList onPick={() => {}} onEdit={setEdit} />
        </aside>
      )}
      <Conversation engine={engine} onAttach={(mode) => setPicker(mode)} />
      {!sidebar && <ChatListDrawer open={listOpen} onClose={() => onListOpenChange(false)} onEdit={setEdit} editing={edit !== null} />}
      <ChatEditSheets edit={edit} onClose={() => setEdit(null)} />
      <PhotoPicker
        open={picker !== null}
        combine={picker === "combine"}
        initial={picker === "combine" ? [] : composer.photoIds}
        onClose={() => setPicker(null)}
        onAttach={(photoIds) => {
          const s = useStore.getState();
          // Photos make a post: on the start screen that's a Post chat.
          if (picker === "combine") {
            const first = ctx.photos.find((p) => p.id === photoIds[0]);
            const category = findCategory(ctx.account.id, first?.category);
            s.setComposer({ photoIds, text: translate(s.lang, "combinePrompt", { category: category ? category.name[s.lang] : translate(s.lang, "myPost") }) });
          } else s.setComposer({ photoIds, text: s.composer.text || translate(s.lang, photoIds.length > 1 ? "photosPrompt" : "photoPrompt") });
          setPicker(null);
        }}
      />
    </div>
  );
}

function Conversation({ engine, onAttach }: { engine: AiEngine; onAttach: (mode: "attach" | "combine") => void }) {
  const { t, l } = useT();
  const ctx = useChatContext();
  const chat = useActiveChat();
  const prompts = PROMPTS;
  const messages = chat?.messages ?? [];
  // Admin preview is read-only: nothing can be sent, so no new chats are made or saved.
  const { isPreview } = useActiveClient();
  const busy = isPreview || engine.typing || messages.some((m) => m.role === "ai" && "ready" in m && !m.ready);
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const hasMessages = useRef(messages.length > 0);
  // Remember which messages existed when the chat opened, so only new answers animate.
  const [seen, setSeen] = useState(() => ({ chat: chat?.id, ids: new Set(messages.map((m) => m.id)) }));
  if (seen.chat !== chat?.id) setSeen({ chat: chat?.id, ids: new Set(messages.map((m) => m.id)) });

  // Keep the newest message in view while answers and steps grow, unless the user scrolled up.
  useEffect(() => {
    const el = scroller.current;
    const inner = content.current;
    if (!el || !inner) return;
    const ro = new ResizeObserver(() => {
      if (stick.current && hasMessages.current) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    });
    ro.observe(inner);
    return () => ro.disconnect();
  }, []);
  // The start screen shows from the top; an existing chat opens at its latest message.
  useLayoutEffect(() => {
    hasMessages.current = messages.length > 0;
  });
  useLayoutEffect(() => {
    stick.current = true;
    scroller.current?.scrollTo({ top: hasMessages.current ? scroller.current.scrollHeight : 0 });
  }, [chat?.id]);
  useEffect(() => {
    stick.current = true;
  }, [messages.length]);

  const runPrompt = (p: Prompt) => {
    if (engine.prompt(p.id, p.q) === "attach") onAttach("combine");
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {chat && (
        <div className="flex h-11 shrink-0 items-center gap-2 border-b px-4 max-lg:hidden">
          <h2 className="min-w-0 truncate text-[15px] font-semibold" dir="auto">
            {l(chat.title)}
          </h2>
        </div>
      )}

      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        <div ref={content} className="mx-auto w-full max-w-[760px] px-4 pt-2 pb-6">
          {messages.length === 0 ? (
            <StartScreen prompts={prompts} onPrompt={runPrompt} readOnly={isPreview} />
          ) : (
            <div className="space-y-6 lg:pt-4">
              {messages.map((m) => {
                if (m.role === "user") return <UserMessage key={m.id} msg={m} />;
                switch (m.kind) {
                  case "post":
                    return <PostMessage key={m.id} msg={m} ctx={ctx} />;
                  case "directions":
                    return <DirectionsMessage key={m.id} msg={m} ctx={ctx} engine={engine} />;
                  case "pickInspiration":
                    return <InspirationMessage key={m.id} msg={m} ctx={ctx} engine={engine} />;
                  case "pickProduct":
                    return <ProductMessage key={m.id} msg={m} ctx={ctx} engine={engine} />;
                  case "text":
                    return <TextMessage key={m.id} msg={m} />;
                  default:
                    return <AnswerMessage key={m.id} msg={m} ctx={ctx} animate={!seen.ids.has(m.id)} />;
                }
              })}
              {engine.typing && <TypingDots />}
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 px-3 pt-1 pb-3">
        <div className="mx-auto w-full max-w-[760px] space-y-2">
          {messages.length > 0 && (
            <div className="no-scrollbar -mx-3 flex gap-2 overflow-x-auto px-3" role="group" aria-label={t("aiTryAsking")}>
              {prompts.map((p) => (
                <Chip key={p.id} onClick={() => runPrompt(p)} disabled={busy}>
                  <p.icon />
                  {l(p.q)}
                </Chip>
              ))}
            </div>
          )}
          {isPreview && (
            <p role="note" className="flex items-center justify-center gap-1.5 text-[12.5px] text-ge-muted-foreground">
              <Eye className="size-3.5" />
              {t("previewReadOnly")}
            </p>
          )}
          <Composer busy={busy} readOnly={isPreview} onSend={engine.send} onAttach={() => onAttach("attach")} />
        </div>
      </div>
    </div>
  );
}

/** No chat open: "What would you like to do?", three shortcut cards (each sends its question) and more suggested questions. */
function StartScreen({ prompts, onPrompt, readOnly }: { prompts: Prompt[]; onPrompt: (p: Prompt) => void; readOnly: boolean }) {
  const { t, l } = useT();
  const id = useId();
  return (
    <div className="flex flex-col items-center pt-[4vh] lg:pt-[9vh]">
      <span className="grid size-12 place-items-center rounded-2xl bg-ig-gradient text-white shadow-[0_8px_24px_-10px_var(--ge-brand)]">
        <Sparkles className="size-6" />
      </span>
      <h2 className="mt-3 text-center text-[22px] font-bold tracking-tight lg:text-[26px]">{t("aiStartTitle")}</h2>

      <div className="mt-5 grid w-full max-w-2xl gap-2 sm:grid-cols-3" role="group" aria-label={t("aiStartTitle")}>
        {SHORTCUTS.map((m) => (
          <button
            key={m.id}
            type="button"
            aria-describedby={`${id}-${m.id}`}
            data-testid={`shortcut-card-${m.id}`}
            disabled={readOnly}
            onClick={() => onPrompt(m.prompt)}
            className="flex items-center gap-3 rounded-2xl border bg-ge-card p-3 text-start transition-[background-color,transform] hover:bg-ge-muted active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50 sm:flex-col sm:items-start sm:p-4"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-ge-brand-soft text-ge-brand-ink">
              <m.icon className="size-5" />
            </span>
            <span className="min-w-0">
              <span className="block text-[15px] font-semibold">{t(m.key)}</span>
              <span id={`${id}-${m.id}`} className="block text-[13px] text-ge-muted-foreground">
                {l(m.prompt.q)}
              </span>
            </span>
          </button>
        ))}
      </div>

      <h3 className="mt-6 w-full max-w-2xl px-1 text-[13px] font-semibold text-ge-muted-foreground">{t("aiTryAsking")}</h3>
      <div className="mt-2 grid w-full max-w-2xl gap-2 sm:grid-cols-2" data-testid="suggested-questions">
        {prompts.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={readOnly}
            onClick={() => onPrompt(p)}
            className="flex items-center gap-3 rounded-2xl border bg-ge-card px-3.5 py-2.5 text-start text-[14px] font-medium transition-colors hover:bg-ge-muted active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-ge-secondary text-ge-foreground">
              <p.icon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">{l(p.q)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Composer({ busy, readOnly, onSend, onAttach }: { busy: boolean; readOnly: boolean; onSend: () => void; onAttach: () => void }) {
  const { t, l } = useT();
  const composer = useStore((s) => s.composer);
  const setComposer = useStore((s) => s.setComposer);
  const photos = useStore((s) => s.photos[s.activeAccountId]);
  const attached = composer.photoIds.map((id) => photos.find((p) => p.id === id)).filter((p) => p !== undefined);
  const input = useRef<HTMLTextAreaElement>(null);
  const reference = composer.reference;
  const canSend = !busy && (composer.text.trim().length > 0 || attached.length > 0 || !!reference);

  // Grow with the text, up to a few lines.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [composer.text]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) onSend();
      }}
      className="rounded-[26px] border bg-ge-background shadow-[0_4px_20px_-12px_rgb(0_0_0/0.25)] focus-within:border-ge-foreground/25"
    >
      {(attached.length > 0 || reference) && (
        <div className="no-scrollbar flex gap-2 overflow-x-auto px-3 pt-3">
          {reference && (
            <span className="relative size-16 shrink-0">
              <ReferenceThumb reference={reference} className="size-full rounded-xl" />
              <button
                type="button"
                aria-label={t("removeReference")}
                onClick={() => setComposer({ reference: undefined })}
                className="absolute -end-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-ge-foreground text-ge-background shadow"
              >
                <X className="size-3" strokeWidth={3} />
              </button>
            </span>
          )}
          {attached.map((p) => (
            <span key={p.id} className="relative size-16 shrink-0">
              <span className="relative block size-full overflow-hidden rounded-xl bg-ge-muted">
                <PhotoImage photo={p} alt={l(p.dish)} sizes="64px" />
              </span>
              <button
                type="button"
                aria-label={`${t("removePhoto")}: ${l(p.dish)}`}
                onClick={() => setComposer({ photoIds: composer.photoIds.filter((id) => id !== p.id) })}
                className="absolute -end-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-ge-foreground text-ge-background shadow"
              >
                <X className="size-3" strokeWidth={3} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-end gap-1 p-1.5">
        <IconBtn label={t("attachPhotos")} onClick={onAttach} disabled={readOnly} className="size-9 disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-5">
          <Plus />
        </IconBtn>
        <textarea
          ref={input}
          rows={1}
          value={composer.text}
          onChange={(e) => setComposer({ text: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (canSend) onSend();
            }
          }}
          placeholder={t("askPlaceholder")}
          aria-label={t("askPlaceholder")}
          disabled={readOnly}
          dir="auto"
          className="max-h-40 disabled:cursor-not-allowed min-h-9 min-w-0 flex-1 resize-none bg-transparent px-1 py-[7px] text-[16px] leading-[22px] outline-none placeholder:text-ge-muted-foreground"
        />
        <button
          type="submit"
          aria-label={t("send")}
          disabled={!canSend}
          className="grid size-9 shrink-0 place-items-center rounded-full bg-ge-brand text-ge-primary-foreground transition-opacity disabled:opacity-35"
        >
          <ArrowUp className="size-5" />
        </button>
      </div>
    </form>
  );
}
