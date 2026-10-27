"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, BarChart3, Blend, CalendarDays, Hash, ImageIcon, ImagePlus, Layers, MessageSquare, Package, Plus, Sparkles, SquarePen, Swords, Wand2, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Chip, IconBtn } from "@/components/gallery/kit";
import { PhotoImage } from "@/components/gallery/photo-image";
import { daysFromNow } from "@/lib/gallery/format";
import { useBackHandler } from "@/lib/gallery/back";
import { useT } from "@/lib/gallery/hooks";
import { translate, type MessageKey } from "@/lib/gallery/i18n";
import { useActiveChat, useChats, useStore } from "@/lib/gallery/store";
import { cn } from "@/lib/gallery/utils";
import { suggestions, type ChatMode } from "@/mock-data/gallery/ai-chat";
import { findCategory } from "@/mock-data/gallery/categories";
import type { AiChat } from "@/mock-data/gallery/ai-studio";
import type { L } from "@/mock-data/gallery/types";
import { useAiEngine, useChatContext, type AiEngine } from "./engine";
import { AnswerMessage, DirectionsMessage, InspirationMessage, PostMessage, ProductMessage, TextMessage, TypingDots, UserMessage } from "./messages";
import { PhotoPicker } from "./photo-picker";

const MODES: { mode: ChatMode; key: MessageKey; icon: typeof ImageIcon }[] = [
  { mode: "post", key: "aiModePost", icon: ImageIcon },
  { mode: "analytics", key: "aiModeAnalytics", icon: BarChart3 },
  { mode: "competitors", key: "aiModeCompetitors", icon: Swords },
];

type Prompt = { id: string; q: L; icon: typeof ImageIcon };

const both = (key: MessageKey): L => ({ en: translate("en", key), ar: translate("ar", key) });

/** Suggested prompts per mode. Post mode leads with the post-making flows. */
function promptsFor(mode: ChatMode): Prompt[] {
  if (mode !== "post") return suggestions[mode].map((s) => ({ id: s.id, q: s.q, icon: mode === "analytics" ? BarChart3 : Swords }));
  return [
    { id: "x-photo", q: both("promptFromPhoto"), icon: ImagePlus },
    { id: "x-combine", q: both("promptCombine"), icon: Blend },
    { id: "x-like", q: both("promptLikeThis"), icon: Wand2 },
    { id: "x-product", q: both("promptProduct"), icon: Package },
    { id: "x-directions", q: both("promptDirections"), icon: Layers },
    { id: "post-next", q: both("promptTomorrow"), icon: CalendarDays },
    { id: "post-hashtags", q: suggestions.post.find((s) => s.id === "post-hashtags")!.q, icon: Hash },
  ];
}

/**
 * The full ChatGPT-style AI chat: modes, messages, composer with photo attachments, and past chats.
 * `sidebar` shows past chats in a column (desktop page); otherwise they open as a drawer.
 */
export function ChatView({ sidebar, historyOpen, onHistoryOpenChange }: { sidebar: boolean; historyOpen: boolean; onHistoryOpenChange: (open: boolean) => void }) {
  const ctx = useChatContext();
  const engine = useAiEngine(ctx);
  // "combine" asks for 2–4 photos and fills in a combine prompt; "attach" is the plain "+".
  const [picker, setPicker] = useState<"attach" | "combine" | null>(null);
  const composer = useStore((s) => s.composer);

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1">
      {sidebar && (
        <aside className="flex w-[260px] shrink-0 flex-col border-e">
          <History onPick={() => {}} showNew />
        </aside>
      )}
      <Conversation engine={engine} onAttach={(mode) => setPicker(mode)} />
      {!sidebar && <HistoryDrawer open={historyOpen} onClose={() => onHistoryOpenChange(false)} />}
      <PhotoPicker
        open={picker !== null}
        combine={picker === "combine"}
        initial={picker === "combine" ? [] : composer.photoIds}
        onClose={() => setPicker(null)}
        onAttach={(photoIds) => {
          const s = useStore.getState();
          s.setChatMode("post");
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
  const mode = useStore((s) => s.chatMode);
  const setMode = useStore((s) => s.setChatMode);
  const prompts = promptsFor(mode);
  const messages = chat?.messages ?? [];
  const busy = engine.typing || messages.some((m) => m.role === "ai" && "ready" in m && !m.ready);
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
  // An empty chat shows the welcome from the top; an existing one opens at its latest message.
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
    if (engine.prompt(p.id, p.q) === "attach") onAttach(p.id === "x-combine" ? "combine" : "attach");
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 justify-center gap-2 px-4 pt-1 pb-2.5">
        {MODES.map((m) => (
          <Chip key={m.mode} active={mode === m.mode} onClick={() => setMode(m.mode)}>
            <m.icon />
            {t(m.key)}
          </Chip>
        ))}
      </div>

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
            <Welcome mode={mode} prompts={prompts} onPrompt={runPrompt} />
          ) : (
            <div className="space-y-6">
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
            <div className="no-scrollbar -mx-3 flex gap-2 overflow-x-auto px-3">
              {prompts.map((p) => (
                <Chip key={p.id} onClick={() => runPrompt(p)} disabled={busy}>
                  <p.icon />
                  {l(p.q)}
                </Chip>
              ))}
            </div>
          )}
          <Composer busy={busy} onSend={engine.send} onAttach={() => onAttach("attach")} />
        </div>
      </div>
    </div>
  );
}

function Welcome({ mode, prompts, onPrompt }: { mode: ChatMode; prompts: Prompt[]; onPrompt: (p: Prompt) => void }) {
  const { t, l } = useT();
  const title = mode === "post" ? t("aiGreetingPost") : mode === "analytics" ? t("aiGreetingAnalytics") : t("aiGreetingCompetitors");
  return (
    <div className="flex min-h-full flex-col items-center pt-[8vh] text-center lg:pt-[12vh]">
      <span className="grid size-14 place-items-center rounded-2xl bg-ig-gradient text-white shadow-[0_8px_24px_-10px_var(--ge-brand)]">
        <Sparkles className="size-7" />
      </span>
      <h1 className="mt-4 text-[24px] font-bold tracking-tight">{title}</h1>
      <p className="mt-1 max-w-sm text-[14px] text-ge-muted-foreground">{mode === "post" ? t("aiGreetingBody") : t("aiGreetingBodyOther")}</p>
      <div className="mt-6 grid w-full max-w-xl gap-2 sm:grid-cols-2">
        {prompts.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onPrompt(p)}
            className="flex items-center gap-3 rounded-2xl border bg-ge-card px-3.5 py-3 text-start text-[14px] font-medium transition-colors hover:bg-ge-muted active:scale-[0.99]"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-ge-brand-soft text-ge-brand-ink">
              <p.icon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">{l(p.q)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Composer({ busy, onSend, onAttach }: { busy: boolean; onSend: () => void; onAttach: () => void }) {
  const { t, l } = useT();
  const composer = useStore((s) => s.composer);
  const setComposer = useStore((s) => s.setComposer);
  const photos = useStore((s) => s.photos[s.activeAccountId]);
  const attached = composer.photoIds.map((id) => photos.find((p) => p.id === id)).filter((p) => p !== undefined);
  const input = useRef<HTMLTextAreaElement>(null);
  const canSend = !busy && (composer.text.trim().length > 0 || attached.length > 0);

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
      {attached.length > 0 && (
        <div className="no-scrollbar flex gap-2 overflow-x-auto px-3 pt-3">
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
        <IconBtn label={t("attachPhotos")} onClick={onAttach} className="size-9 [&_svg]:size-5">
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
          dir="auto"
          className="max-h-40 min-h-9 min-w-0 flex-1 resize-none bg-transparent px-1 py-[7px] text-[16px] leading-[22px] outline-none placeholder:text-ge-muted-foreground"
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

/* ---------- Past chats ---------- */

function History({ onPick, showNew }: { onPick: () => void; showNew: boolean }) {
  const { t, l } = useT();
  const chats = useChats();
  const activeId = useStore((s) => s.activeChatId);
  const photos = useStore((s) => s.photos[s.activeAccountId]);
  const groups: { title: string; items: AiChat[] }[] = [
    { title: t("today"), items: chats.filter((c) => daysFromNow(c.at) === 0) },
    { title: t("previous7Days"), items: chats.filter((c) => daysFromNow(c.at) !== 0) },
  ].filter((g) => g.items.length > 0);

  const thumbOf = (c: AiChat) => {
    for (const m of c.messages) {
      const id = m.role === "user" ? m.photoIds?.[0] : m.kind === "post" ? m.post.photoIds[0] : undefined;
      const p = id && photos.find((x) => x.id === id);
      if (p) return p.thumb;
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={cn("p-2", !showNew && "hidden")}>
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
      <nav aria-label={t("chats")} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-2 pb-4">
        {groups.length === 0 && <p className="px-3 py-2 text-[13px] text-ge-muted-foreground">{t("noChats")}</p>}
        {groups.map((g) => (
          <div key={g.title}>
            <h3 className="px-3 pb-1 text-[12px] font-semibold text-ge-muted-foreground">{g.title}</h3>
            <ul>
              {g.items.map((c) => {
                const thumb = thumbOf(c);
                const Icon = c.mode === "analytics" ? BarChart3 : c.mode === "competitors" ? Swords : MessageSquare;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      aria-current={c.id === activeId ? "true" : undefined}
                      onClick={() => {
                        useStore.getState().openChat(c.id);
                        onPick();
                      }}
                      className={cn("flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-start text-[14px] hover:bg-ge-muted", c.id === activeId && "bg-ge-muted font-semibold")}
                    >
                      <span className="relative grid size-8 shrink-0 place-items-center overflow-hidden rounded-lg bg-ge-secondary text-ge-muted-foreground">
                        {thumb ? <Image unoptimized src={thumb} alt="" fill sizes="32px" className="object-cover" /> : <Icon className="size-4" />}
                      </span>
                      <span className="min-w-0 flex-1 truncate" dir="auto">
                        {l(c.title)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  );
}

function HistoryDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, dir } = useT();
  const side = dir === "rtl" ? "100%" : "-100%";
  useBackHandler(open, onClose);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), onClose());
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <div className="absolute inset-0 z-20">
          <motion.div className="absolute inset-0 bg-black/35" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
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
              <IconBtn label={t("close")} onClick={onClose} className="size-9 [&_svg]:size-5">
                <X />
              </IconBtn>
            </div>
            <History onPick={onClose} showNew={false} />
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
