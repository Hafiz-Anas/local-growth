"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CalendarClock, Check, ChevronDown, CircleCheck, Copy, ImageDown, LoaderCircle, PencilLine, RefreshCw, Send, Sparkles } from "lucide-react";
import Image from "next/image";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { BarChart } from "@/components/gallery/charts";
import { PhotoImage } from "@/components/gallery/photo-image";
import { Avatar, Btn, Chip, Segmented, Skel } from "@/components/gallery/kit";
import { compact, num, when } from "@/lib/gallery/format";
import { useT } from "@/lib/gallery/hooks";
import type { MessageKey } from "@/lib/gallery/i18n";
import { useAccount, useStore } from "@/lib/gallery/store";
import { cn } from "@/lib/gallery/utils";
import { answer, type ChatContext } from "@/mock-data/gallery/ai-chat";
import { DIRECTION_LABEL, FEATURE_LABEL, fullCaption, inspirationSources, productsFor, recaption, retone, type AiMsg, type PostDraft, type Step } from "@/mock-data/gallery/ai-studio";
import { findCategory } from "@/mock-data/gallery/categories";
import type { CaptionTone, Lang, Photo } from "@/mock-data/gallery/types";
import type { AiEngine } from "./engine";

type AiOf<K> = Extract<AiMsg, { role: "ai"; kind: K }>;

/* ---------- Layout ---------- */

export function AiRow({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <div id={id} className="flex scroll-mt-4 items-start gap-2.5">
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-ge-brand text-ge-primary-foreground">
        <Sparkles className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1 space-y-2.5 pt-1 text-[15px] leading-relaxed">{children}</div>
    </div>
  );
}

export function UserMessage({ msg }: { msg: Extract<AiMsg, { role: "user" }> }) {
  const { l } = useT();
  const photos = useStore((s) => s.photos[s.activeAccountId]);
  const attached = (msg.photoIds ?? []).map((id) => photos.find((p) => p.id === id)).filter((p) => p !== undefined);
  return (
    <div className="flex flex-col items-end gap-1.5">
      {(attached.length > 0 || msg.refThumb) && (
        <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
          {attached.slice(0, 4).map((p) => (
            <span key={p.id} className="relative size-20 overflow-hidden rounded-2xl bg-ge-muted sm:size-24">
              <PhotoImage photo={p} alt={l(p.dish)} sizes="96px" />
            </span>
          ))}
          {attached.length > 4 && <span className="grid size-20 place-items-center rounded-2xl bg-ge-muted text-sm font-semibold sm:size-24">+{attached.length - 4}</span>}
          {msg.refThumb && (
            <span className="relative size-20 overflow-hidden rounded-2xl bg-ge-muted sm:size-24">
              <Image unoptimized src={msg.refThumb} alt="" fill sizes="96px" className="object-cover" />
            </span>
          )}
        </div>
      )}
      <p dir="auto" className="max-w-[85%] rounded-[20px] bg-ge-secondary px-3.5 py-2 text-[15px] leading-snug whitespace-pre-line">
        {l(msg.text)}
      </p>
    </div>
  );
}

export function TypingDots() {
  const { t } = useT();
  return (
    <AiRow>
      <span className="flex h-6 items-center gap-1" role="status" aria-label={t("thinking")}>
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="size-1.5 rounded-full bg-ge-muted-foreground"
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }}
          />
        ))}
      </span>
    </AiRow>
  );
}

/* ---------- Progress steps ---------- */

const STEP_MS = 750;
const STEP_KEY: Record<Step["key"], MessageKey> = {
  look: "stepLook",
  style: "stepStyle",
  product: "stepProduct",
  caption: "stepCaption",
  hashtags: "stepHashtags",
  time: "stepTime",
  directions: "stepDirections",
  images: "stepImages",
  combine: "stepCombine",
};

/** Runs the visible "working" steps, then marks the message ready so its result shows. */
function useSteps(msgId: string, steps: Step[], ready: boolean) {
  const [done, setDone] = useState(ready ? steps.length : 0);
  useEffect(() => {
    if (ready) return;
    const timer = window.setTimeout(() => {
      if (done < steps.length) setDone(done + 1);
      else useStore.getState().updateAiMsg(msgId, { ready: true });
    }, done < steps.length ? STEP_MS : 250);
    return () => window.clearTimeout(timer);
  }, [done, ready, steps.length, msgId]);
  return ready ? steps.length : done;
}

function Steps({ steps, done, ready }: { steps: Step[]; done: number; ready: boolean }) {
  const { t, l, lang } = useT();
  const [open, setOpen] = useState(false);
  const label = (s: Step) => t(STEP_KEY[s.key], { v: l(s.v) });
  const list = (
    <ol className="space-y-1.5" aria-live="polite">
      {steps.map((s, i) => {
        const state = i < done ? "done" : i === done && !ready ? "active" : "todo";
        return (
          <li key={s.key} className={cn("flex items-center gap-2 text-[13.5px]", state === "todo" && "text-ge-muted-foreground/60", state === "done" && "text-ge-muted-foreground")}>
            {state === "done" ? (
              <CircleCheck className="size-4 shrink-0 text-ge-brand" />
            ) : state === "active" ? (
              <LoaderCircle className="size-4 shrink-0 animate-spin text-ge-brand" />
            ) : (
              <span className="mx-[3px] size-2.5 shrink-0 rounded-full border-2 border-current" />
            )}
            <span dir="auto">{label(s)}</span>
          </li>
        );
      })}
    </ol>
  );
  if (!ready) return <div className="rounded-2xl border bg-ge-card px-3.5 py-3">{list}</div>;
  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="inline-flex items-center gap-1.5 rounded-full text-[12.5px] font-medium text-ge-muted-foreground hover:text-ge-foreground">
        <CircleCheck className="size-3.5 text-ge-brand" />
        {t("stepsDone", { n: num(steps.length, lang) })}
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open && <div className="mt-2 ps-1">{list}</div>}
    </div>
  );
}

/* ---------- Post message ---------- */

export function PostMessage({ msg, ctx }: { msg: AiOf<"post">; ctx: ChatContext }) {
  const { l } = useT();
  const done = useSteps(msg.id, msg.steps, msg.ready);
  return (
    <AiRow id={msg.id}>
      {msg.text && msg.ready && <p className="whitespace-pre-line" dir="auto">{l(msg.text)}</p>}
      <Steps steps={msg.steps} done={done} ready={msg.ready} />
      <AnimatePresence initial={false}>
        {msg.ready && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
            <PostCard msgId={msg.id} post={msg.post} ctx={ctx} />
          </motion.div>
        )}
      </AnimatePresence>
    </AiRow>
  );
}

const TONES: { tone: CaptionTone; key: MessageKey }[] = [
  { tone: "shorter", key: "shorter" },
  { tone: "formal", key: "moreFormal" },
  { tone: "friendly", key: "friendlier" },
];

function PostCard({ msgId, post, ctx }: { msgId: string; post: PostDraft; ctx: ChatContext }) {
  const { t, l, lang } = useT();
  const account = useAccount();
  const [captionLang, setCaptionLang] = useState<Lang>(lang);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [toneMenu, setToneMenu] = useState(false);
  const [writing, setWriting] = useState(false);
  const photos = post.photoIds.map((id) => ctx.photos.find((p) => p.id === id)).filter((p) => p !== undefined);
  const update = (patch: Partial<PostDraft>) => useStore.getState().updateAiMsg(msgId, { post: { ...post, ...patch } });
  const s = useStore.getState;

  const regenerate = (tone: CaptionTone) => {
    setToneMenu(false);
    setWriting(true);
    window.setTimeout(() => {
      useStore.getState().updateAiMsg(msgId, { post: retone(ctx, post, tone) });
      setWriting(false);
    }, 800);
  };

  const approve = () => {
    s().schedulePhotos(post.photoIds, post.time, fullCaption(post));
    update({ status: "scheduled" });
    toast.success(t("scheduledMoved", { when: when(post.time, lang) }));
  };
  const postNow = () => {
    s().publishPhotos(post.photoIds, fullCaption(post));
    update({ status: "posted" });
    toast.success(t("posted"));
  };
  // Saves the post (photo, caption, hashtags) to the gallery: AI Generated + its category album. Nothing is scheduled.
  const saveToGallery = () => {
    s().savePost(post.photoIds, fullCaption(post));
    update({ status: "saved" });
    const category = findCategory(account.id, photos[0]?.category);
    toast.success(category ? t("savedToGalleryIn", { album: l(category.name) }) : t("savedToGallery"));
  };
  const openInGallery = () => {
    s().closeSheet();
    s().openViewer(post.photoIds, 0);
  };

  // Picking an AI image saves it to the AI Generated album; switching away removes the one that's no longer used.
  const pickVariant = (i: number | undefined) => {
    if (!post.variants || !post.originalId || i === post.variant) return;
    const variants = [...post.variants];
    const prev = post.variant !== undefined ? variants[post.variant] : undefined;
    if (prev?.photoId) {
      const used = s().photos[s().activeAccountId].find((p) => p.id === prev.photoId);
      if (used && used.status === "none" && !used.caption && !used.favorite) s().deletePhotos([used.id]);
      variants[post.variant!] = { ...prev, photoId: undefined };
    }
    let cover = post.originalId;
    if (i !== undefined) {
      const { src, thumb, look, dish, category, credit } = variants[i];
      cover = s().addAiImage({ src, thumb, look, dish, category, credit });
      variants[i] = { ...variants[i], photoId: cover };
      toast.success(t("aiImageSaved"));
    }
    // The caption follows the picked image's item, unless the user already wrote their own.
    const subject = i !== undefined ? variants[i] : ctx.photos.find((p) => p.id === post.originalId);
    const next = subject && !post.edited ? recaption(ctx, post, subject) : post;
    useStore.getState().updateAiMsg(msgId, { post: { ...next, variants, variant: i, photoIds: [cover, ...post.photoIds.slice(1)] } });
  };

  const badge = post.inspiredBy ? (
    t("inspiredBy", { handle: post.inspiredBy })
  ) : post.direction ? (
    l(DIRECTION_LABEL[post.direction])
  ) : (
    t("suggestedPost")
  );

  return (
    <article className="w-full max-w-[420px] overflow-hidden rounded-2xl border bg-ge-card shadow-[0_2px_12px_-6px_rgb(0_0_0/0.15)]">
      <header className="flex items-center gap-2.5 px-3 py-2.5">
        <Avatar src={account.avatar} alt={account.handle} size={30} />
        <p className="min-w-0 flex-1 truncate text-[13px] font-semibold" dir="ltr">
          {account.handle}
        </p>
        <span className="inline-flex max-w-[60%] items-center gap-1 truncate rounded-full bg-ge-brand-soft px-2 py-0.5 text-[11.5px] font-semibold text-ge-brand-ink">
          <Sparkles className="size-3 shrink-0" />
          <span className="truncate">{badge}</span>
        </span>
      </header>

      <Photos photos={photos} />

      <div className="space-y-3 p-3">
        {post.variants && (
          <div>
            <p className="text-[12px] font-semibold text-ge-muted-foreground">{t("aiImagesTitle")}</p>
            <div className="-mx-3 mt-1.5 flex gap-2 overflow-x-auto px-3 pb-1 max-lg:no-scrollbar" role="radiogroup" aria-label={t("aiImagesTitle")}>
              {[undefined, ...post.variants.map((_, i) => i)].map((i) => {
                const original = i === undefined;
                const image = original ? ctx.photos.find((p) => p.id === post.originalId) : post.variants![i];
                if (!image) return null;
                const on = post.variant === i;
                return (
                  <button
                    key={original ? "original" : i}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={post.status !== "new" || writing}
                    onClick={() => pickVariant(i)}
                    className={cn(
                      "relative size-[72px] shrink-0 overflow-hidden rounded-xl bg-ge-muted transition-[transform,opacity] enabled:active:scale-95 disabled:opacity-60",
                      on && "ring-[3px] ring-ge-brand ring-offset-2 ring-offset-ge-card",
                    )}
                  >
                    <PhotoImage photo={image} sizes="72px" />
                    <span
                      className={cn(
                        "absolute inset-x-1 bottom-1 inline-flex items-center justify-center gap-0.5 truncate rounded-full px-1 py-0.5 text-[10px] leading-none font-bold text-white",
                        original ? "bg-black/55" : "bg-ge-brand/90",
                      )}
                    >
                      {!original && <Sparkles className="size-2.5 shrink-0" />}
                      {original ? t("original") : t("aiShort")}
                    </span>
                    {on && (
                      <span className="absolute end-1 top-1 grid size-4 place-items-center rounded-full bg-ge-brand text-white">
                        <Check className="size-2.5" strokeWidth={3.5} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-[11.5px] leading-snug text-ge-muted-foreground">{t("aiImagesHint")}</p>
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <p className="text-[12px] font-semibold text-ge-muted-foreground">{t("caption")}</p>
          <Segmented
            label={t("language")}
            value={captionLang}
            onChange={(v) => (setCaptionLang(v), setEditing(false))}
            options={[
              { value: "en", label: "EN" },
              { value: "ar", label: "ع" },
            ]}
            className="w-24 [&_button]:h-7"
          />
        </div>

        {editing ? (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            dir={captionLang === "ar" ? "rtl" : "ltr"}
            lang={captionLang}
            rows={5}
            aria-label={t("caption")}
            className="w-full resize-none rounded-xl bg-ge-muted px-3 py-2.5 text-[15px] leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ge-ring"
            autoFocus
          />
        ) : writing ? (
          <div aria-busy className="space-y-2 py-1">
            <span className="sr-only">{t("thinking")}</span>
            <Skel className="h-3.5 w-11/12" />
            <Skel className="h-3.5 w-10/12" />
            <Skel className="h-3.5 w-7/12" />
          </div>
        ) : (
          <p className="text-[14.5px] leading-relaxed whitespace-pre-line" dir={captionLang === "ar" ? "rtl" : "ltr"} lang={captionLang}>
            {post.caption[captionLang]}
          </p>
        )}

        <div className="flex flex-wrap gap-1.5" aria-label={t("hashtags")}>
          {post.hashtags.map((tag) => (
            <bdi key={tag} className="rounded-full bg-ge-muted px-2 py-0.5 text-[12.5px] font-medium text-ge-brand-ink">
              {tag}
            </bdi>
          ))}
        </div>

        <p className="flex items-center gap-1.5 text-[13px]">
          <CalendarClock className="size-4 shrink-0 text-ge-brand" />
          <span className="font-semibold">{when(post.time, lang)}</span>
          <span className="text-ge-muted-foreground">· {t("bestTime")}</span>
        </p>

        {post.inspiredBy && <p className="text-[12px] text-ge-muted-foreground">{t("notCopied")}</p>}
        {post.edited && !editing && (
          <p className="flex items-center gap-1 text-[12px] text-ge-muted-foreground">
            <PencilLine className="size-3" /> {t("edited")}
          </p>
        )}

        {post.status !== "new" ? (
          <div className="flex items-center gap-2 rounded-xl bg-ge-brand-soft px-3 py-2 text-[13.5px] font-semibold text-ge-brand-ink" role="status">
            <Check className="size-4 shrink-0" strokeWidth={3} />
            <span className="min-w-0 flex-1">
              {post.status === "scheduled"
                ? t("scheduledFor", { when: when(post.time, lang) })
                : post.status === "posted"
                  ? t("postedStatus")
                  : post.status === "saved"
                    ? t("savedStatus")
                    : t("draftStatus")}
            </span>
            {photos.length > 0 && (
              <button type="button" onClick={openInGallery} className="shrink-0 rounded-full px-2 py-1 text-[13px] underline-offset-2 hover:underline">
                {t("openInGallery")}
              </button>
            )}
          </div>
        ) : editing ? (
          <div className="grid grid-cols-2 gap-2">
            <Btn variant="secondary" onClick={() => setEditing(false)}>
              {t("cancel")}
            </Btn>
            <Btn
              onClick={() => {
                update({ caption: { ...post.caption, [captionLang]: text }, edited: true });
                setEditing(false);
              }}
            >
              {t("save")}
            </Btn>
          </div>
        ) : (
          <div className="space-y-2">
            <Btn className="w-full" icon={<CalendarClock />} onClick={approve} disabled={writing}>
              {t("approveSchedule")}
            </Btn>
            <div className="grid grid-cols-4 gap-1">
              <CardAction icon={<Send />} label={t("postNow")} onClick={postNow} disabled={writing} />
              <CardAction
                icon={<PencilLine />}
                label={t("edit")}
                onClick={() => {
                  setText(post.caption[captionLang]);
                  setToneMenu(false);
                  setEditing(true);
                }}
                disabled={writing}
              />
              <CardAction icon={<RefreshCw className={cn(writing && "animate-spin")} />} label={t("regenerate")} onClick={() => setToneMenu((o) => !o)} pressed={toneMenu} disabled={writing} />
              <CardAction icon={<ImageDown />} label={t("saveToGallery")} onClick={saveToGallery} disabled={writing} />
            </div>
            {toneMenu && (
              <div className="flex flex-wrap gap-2 pt-1">
                {TONES.map((x) => (
                  <Chip key={x.tone} active={post.tone === x.tone && !post.edited} onClick={() => regenerate(x.tone)}>
                    {t(x.key)}
                  </Chip>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function CardAction({ icon, label, onClick, pressed, disabled }: { icon: ReactNode; label: string; onClick: () => void; pressed?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      disabled={disabled}
      className={cn(
        "flex min-w-0 flex-col items-center gap-1 rounded-xl px-0.5 py-2 text-[11.5px] leading-tight font-medium hover:bg-ge-muted disabled:opacity-40 [&_svg]:size-5",
        pressed && "bg-ge-muted",
      )}
    >
      {icon}
      <span className="line-clamp-2 w-full text-center">{label}</span>
    </button>
  );
}

function Photos({ photos }: { photos: Photo[] }) {
  const { t, l } = useT();
  const [index, setIndex] = useState(0);
  return (
    <div className="relative">
      <div
        className="no-scrollbar flex aspect-square snap-x snap-mandatory overflow-x-auto bg-ge-muted"
        onScroll={(e) => setIndex(Math.round(Math.abs(e.currentTarget.scrollLeft) / e.currentTarget.clientWidth))}
      >
        {photos.map((p) => (
          <div key={p.id} className="relative aspect-square w-full shrink-0 snap-center">
            <PhotoImage photo={p} full alt={l(p.dish)} sizes="420px" />
            {p.source === "ai" && (
              <span className="absolute start-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-ge-brand/90 px-2 py-0.5 text-[11px] font-bold text-white">
                <Sparkles className="size-3" /> {t("aiImage")}
              </span>
            )}
          </div>
        ))}
      </div>
      {photos.length > 1 && (
        <span className="absolute end-2.5 top-2.5 rounded-full bg-black/60 px-2 py-0.5 text-xs font-medium text-white" dir="ltr">
          {index + 1}/{photos.length}
        </span>
      )}
    </div>
  );
}

/* ---------- Directions ---------- */

export function DirectionsMessage({ msg, ctx, engine }: { msg: AiOf<"directions">; ctx: ChatContext; engine: AiEngine }) {
  const { t, l } = useT();
  const done = useSteps(msg.id, msg.steps, msg.ready);
  return (
    <AiRow id={msg.id}>
      {msg.text && msg.ready && <p className="whitespace-pre-line" dir="auto">{l(msg.text)}</p>}
      <Steps steps={msg.steps} done={done} ready={msg.ready} />
      {msg.ready && msg.features && (
        <ul className="grid max-w-md gap-1.5" aria-label={t("combineTook")}>
          {msg.features.map((f) => {
            const photo = ctx.photos.find((p) => p.id === f.photoId);
            return (
              <li key={f.photoId} className="flex items-center gap-2.5 rounded-xl border bg-ge-card p-1.5 pe-3">
                <span className="relative size-11 shrink-0 overflow-hidden rounded-lg bg-ge-muted">{photo && <PhotoImage photo={photo} alt={l(photo.dish)} sizes="44px" />}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-semibold">{l(FEATURE_LABEL[f.key])}</span>
                  <span className="block truncate text-[12px] text-ge-muted-foreground">{t("fromPhoto", { name: photo ? l(photo.dish) : "" })}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {msg.ready && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="-mx-2 flex snap-x snap-mandatory gap-3 overflow-x-auto px-2 pb-2 max-lg:no-scrollbar"
          role="list"
        >
          {msg.options.map((o, i) => {
            const photo = o.aiImage ?? ctx.photos.find((p) => p.id === o.photoIds[0]);
            const chosen = msg.chosen === i;
            const other = msg.chosen !== undefined && !chosen;
            return (
              <div
                key={i}
                role="listitem"
                className={cn(
                  "flex w-[74%] max-w-[250px] shrink-0 snap-start flex-col overflow-hidden rounded-2xl border bg-ge-card transition-opacity sm:w-[230px]",
                  chosen && "border-ge-brand ring-2 ring-ge-brand",
                  other && "opacity-45",
                )}
              >
                <div className="relative aspect-square bg-ge-muted">
                  {photo && <PhotoImage photo={photo} alt={l(photo.dish)} sizes="250px" />}
                  <span className="absolute start-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[11.5px] font-semibold text-white backdrop-blur">
                    {l(DIRECTION_LABEL[o.direction ?? "warm"])}
                  </span>
                  {o.aiImage && (
                    <span className="absolute end-2 top-2 inline-flex items-center gap-0.5 rounded-full bg-ge-brand/90 px-1.5 py-0.5 text-[10.5px] font-bold text-white">
                      <Sparkles className="size-2.5" /> {t("aiShort")}
                    </span>
                  )}
                </div>
                <p className="line-clamp-4 flex-1 px-3 pt-2.5 text-[13.5px] leading-snug whitespace-pre-line" dir="auto">
                  {l(o.caption)}
                </p>
                <div className="p-3">
                  <Btn
                    size="sm"
                    variant={chosen ? "primary" : "secondary"}
                    className="w-full"
                    disabled={msg.chosen !== undefined || engine.typing}
                    onClick={() => engine.chooseDirection(msg.id, i)}
                    icon={chosen ? <Check /> : undefined}
                  >
                    {chosen ? t("chosen") : t("useThis")}
                  </Btn>
                </div>
              </div>
            );
          })}
        </motion.div>
      )}
    </AiRow>
  );
}

/* ---------- Pickers ---------- */

export function InspirationMessage({ msg, ctx, engine }: { msg: AiOf<"pickInspiration">; ctx: ChatContext; engine: AiEngine }) {
  const { t, lang } = useT();
  const sources = inspirationSources(ctx);
  const [tab, setTab] = useState<"own" | "competitors">(msg.chosen?.startsWith("comp:") ? "competitors" : "own");
  const list = sources[tab];
  return (
    <AiRow id={msg.id}>
      <p>{t("pickInspo")}</p>
      <Segmented
        label={t("promptLikeThis")}
        value={tab}
        onChange={setTab}
        options={[
          { value: "own", label: t("yourTopPosts") },
          { value: "competitors", label: t("competitors") },
        ]}
        className="max-w-xs"
      />
      <div className="-mx-2 flex gap-2 overflow-x-auto px-2 pb-1 max-lg:no-scrollbar">
        {list.map((s) => {
          const chosen = msg.chosen === s.id;
          return (
            <button
              key={s.id}
              type="button"
              disabled={!!msg.chosen || engine.typing}
              onClick={() => engine.pickInspiration(msg.id, s.id)}
              aria-pressed={chosen}
              aria-label={`@${s.handle}`}
              className={cn(
                "relative size-28 shrink-0 overflow-hidden rounded-xl bg-ge-muted text-start transition-[opacity,transform] enabled:active:scale-95 sm:size-32",
                chosen && "ring-[3px] ring-ge-brand ring-offset-2 ring-offset-ge-background",
                msg.chosen && !chosen && "opacity-40",
              )}
            >
              <Image unoptimized src={s.thumb} alt="" fill sizes="128px" className="object-cover" />
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-2 pt-5 pb-1.5 text-[11px] leading-tight font-semibold text-white">
                <span className="block truncate" dir="ltr">
                  @{s.handle}
                </span>
                <span className="block font-normal opacity-85">
                  {s.own ? `${compact(s.stat, lang)} ${t("reach").toLowerCase()}` : `${compact(s.stat, lang)} ${t("followers").toLowerCase()}`}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </AiRow>
  );
}

export function ProductMessage({ msg, ctx, engine }: { msg: AiOf<"pickProduct">; ctx: ChatContext; engine: AiEngine }) {
  const { t, l } = useT();
  return (
    <AiRow id={msg.id}>
      <p>{t("pickProduct")}</p>
      <div className="flex flex-wrap gap-2">
        {productsFor(ctx.account.id).map((p) => (
          <Chip
            key={p.id}
            active={msg.chosen === p.id}
            disabled={!!msg.chosen || engine.typing}
            onClick={() => engine.pickProduct(msg.id, p.id)}
            className={cn("h-auto min-h-9 py-1.5", msg.chosen && msg.chosen !== p.id && "opacity-45")}
          >
            <span className="font-semibold">{l(p.name)}</span>
            <span className={cn("text-[12px]", msg.chosen === p.id ? "opacity-80" : "text-ge-muted-foreground")}>{l(p.price)}</span>
          </Chip>
        ))}
      </div>
    </AiRow>
  );
}

/* ---------- Canned answers (analytics, competitors, hashtags…) ---------- */

/** Reveals text word by word, like a streamed answer. Instant with reduced motion. */
function Stream({ text, animate }: { text: string; animate: boolean }) {
  const reduce = useReducedMotion();
  const words = text.split(" ");
  const [count, setCount] = useState(animate && !reduce ? 0 : words.length);
  useEffect(() => {
    if (count >= words.length) return;
    const id = window.setTimeout(() => setCount((c) => c + 2), 28);
    return () => window.clearTimeout(id);
  }, [count, words.length]);
  return <>{words.slice(0, count).join(" ")}</>;
}

export function AnswerMessage({ msg, ctx, animate }: { msg: AiOf<"answer">; ctx: ChatContext; animate: boolean }) {
  const { t, l, lang } = useT();
  const a = answer(msg.answerId, ctx);
  const photo = a.photoId ? ctx.photos.find((p) => p.id === a.photoId) : undefined;
  return (
    <AiRow id={msg.id}>
      {a.estimate && (
        <span className="inline-flex items-center gap-1 rounded-full bg-ge-brand-soft px-2 py-0.5 text-[11px] font-semibold text-ge-brand-ink">
          <Sparkles className="size-3" /> {t("estimate")}
        </span>
      )}
      <p>
        <Stream text={l(a.text)} animate={animate} />
      </p>
      {a.bullets && (
        <div className="space-y-2">
          {a.bullets.map((b, i) => (
            <div key={i} className="rounded-xl border bg-ge-card p-3 text-[14px] whitespace-pre-line" dir="auto">
              {l(b)}
              {msg.answerId === "post-caption" && <CopyButton text={l(b)} />}
            </div>
          ))}
        </div>
      )}
      {photo && (
        <button
          type="button"
          onClick={() => useStore.getState().openViewer([photo.id], 0)}
          className="flex w-full max-w-sm items-center gap-2.5 rounded-xl border bg-ge-card p-2 text-start hover:bg-ge-muted/60"
        >
          <span className="relative size-12 shrink-0 overflow-hidden rounded-lg bg-ge-muted">
            <PhotoImage photo={photo} sizes="48px" />
          </span>
          <span className="truncate text-[14px] font-medium">{l(photo.dish)}</span>
        </button>
      )}
      {a.chart && (
        <div className="max-w-md rounded-xl border bg-ge-card p-3">
          <BarChart
            title={t("reach")}
            values={a.chart.values}
            labels={a.chart.labels.map((x) => l(x))}
            tickLabels={a.chart.labels.map((x) => l(x))}
            highlight={a.chart.highlight}
            format={(v) => num(v, lang)}
            height={96}
          />
        </div>
      )}
    </AiRow>
  );
}

function CopyButton({ text }: { text: string }) {
  const { t } = useT();
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          /* clipboard may be blocked */
        }
        toast.success(t("copied"));
      }}
      className="mt-2 flex items-center gap-1 text-[12px] font-semibold text-ge-brand-ink"
    >
      <Copy className="size-3.5" /> {t("copy")}
    </button>
  );
}

export function TextMessage({ msg }: { msg: AiOf<"text"> }) {
  const { l } = useT();
  return (
    <AiRow id={msg.id}>
      <p className="whitespace-pre-line" dir="auto">
        {l(msg.text)}
      </p>
    </AiRow>
  );
}
