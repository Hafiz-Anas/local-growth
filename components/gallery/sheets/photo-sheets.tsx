"use client";

import { BarChart3, CalendarClock, Check, FolderPlus, ImageUp, Images, PencilLine, Send, Sparkles } from "lucide-react";
import Image from "next/image";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { BarChart } from "@/components/gallery/charts";
import { Btn, Delta, Segmented } from "@/components/gallery/kit";
import { PhotoImage } from "@/components/gallery/photo-image";
import { PostStatus } from "@/components/gallery/photo-viewer";
import { PostPreview } from "@/components/gallery/post-preview";
import { Sheet } from "@/components/gallery/sheet";
import { compact, dayKey, num, time, when } from "@/lib/gallery/format";
import { useInsights, useT } from "@/lib/gallery/hooks";
import { useAlbums, usePhotos, useStore } from "@/lib/gallery/store";
import { alternativeTimes, suggestedTime } from "@/lib/gallery/suggest";
import { cn } from "@/lib/gallery/utils";
import { cameraRoll } from "@/mock-data/gallery/photos";
import type { AccountId, Lang } from "@/mock-data/gallery/types";
import { useSheet } from "./use-sheet";

/* ---------- Schedule ---------- */

export function ScheduleSheet() {
  const { open, data, close } = useSheet("schedule");
  const { t, lang } = useT();
  const photos = usePhotos();
  const insights = useInsights();
  const suggested = data?.suggested ?? suggestedTime(insights);
  const options = [suggested, ...alternativeTimes(insights).filter((x) => x !== suggested)].slice(0, 4);
  const [choice, setChoice] = useState<string>("0");
  const [customDate, setCustomDate] = useState(dayKey(options[0]));
  const [customTime, setCustomTime] = useState("20:30");
  const chosen = data?.photoIds.map((id) => photos.find((p) => p.id === id)).filter((p) => p !== undefined) ?? [];

  const at = choice === "custom" ? new Date(`${customDate}T${customTime}:00+03:00`).toISOString() : options[Number(choice)];

  const confirm = () => {
    if (!data) return;
    useStore.getState().schedulePhotos(data.photoIds, at, data.caption);
    toast.success(t("scheduledToast", { when: when(at, lang) }));
    close();
    setChoice("0");
  };

  return (
    <Sheet
      open={open}
      onClose={close}
      title={t("schedule")}
      footer={
        <Btn size="lg" className="w-full" icon={<CalendarClock />} onClick={confirm}>
          {t("schedule")}
        </Btn>
      }
    >
      <div className="space-y-5 px-4 pt-1 pb-4">
        {chosen.length > 0 && (
          <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
            {chosen.map((p) => (
              <span key={p.id} className="relative size-16 shrink-0 overflow-hidden rounded-lg bg-ge-muted">
                <PhotoImage photo={p} sizes="64px" />
              </span>
            ))}
          </div>
        )}
        <fieldset>
          <legend className="mb-2 text-[13px] font-semibold text-ge-muted-foreground">
            {t("suggested")} • {t("kuwaitTime")}
          </legend>
          <div className="divide-y overflow-hidden rounded-2xl border">
            {options.map((iso, i) => (
              <Radio key={iso} checked={choice === String(i)} onSelect={() => setChoice(String(i))}>
                <span className="flex-1 text-[15px]">{when(iso, lang)}</span>
                {i === 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-ge-brand-soft px-2 py-0.5 text-[11px] font-semibold text-ge-brand-ink">
                    <Sparkles className="size-3" /> {t("bestTime")}
                  </span>
                )}
              </Radio>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-2 text-[13px] font-semibold text-ge-muted-foreground">{t("pickTime")}</legend>
          <div className="overflow-hidden rounded-2xl border">
            <Radio checked={choice === "custom"} onSelect={() => setChoice("custom")}>
              <div className="flex flex-1 gap-2">
                <input
                  type="date"
                  value={customDate}
                  aria-label={t("date")}
                  onChange={(e) => (setCustomDate(e.target.value), setChoice("custom"))}
                  className="h-10 min-w-0 flex-1 rounded-lg bg-ge-muted px-2 text-[14px]"
                />
                <input
                  type="time"
                  value={customTime}
                  aria-label={t("time")}
                  onChange={(e) => (setCustomTime(e.target.value), setChoice("custom"))}
                  className="h-10 w-28 rounded-lg bg-ge-muted px-2 text-[14px]"
                />
              </div>
            </Radio>
          </div>
        </fieldset>
      </div>
    </Sheet>
  );
}

function Radio({ checked, onSelect, children }: { checked: boolean; onSelect: () => void; children: React.ReactNode }) {
  return (
    <div
      role="radio"
      aria-checked={checked}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === " " || e.key === "Enter") && (e.preventDefault(), onSelect())}
      className="flex min-h-12 cursor-pointer items-center gap-3 px-4 py-2 hover:bg-ge-muted/50"
    >
      <span className={cn("grid size-5 shrink-0 place-items-center rounded-full border-2", checked ? "border-ge-brand bg-ge-brand" : "border-ge-foreground/25")}>
        {checked && <span className="size-2 rounded-full bg-white" />}
      </span>
      {children}
    </div>
  );
}

/* ---------- Add to album / move ---------- */

export function AlbumSheet() {
  const { open, data, close } = useSheet("album");
  const { t, l } = useT();
  const albums = useAlbums();
  const photos = usePhotos();
  const from = albums.find((a) => a.id === data?.fromAlbumId);
  const [move, setMove] = useState(true);
  const moving = !!from && move;

  const add = (albumId: string) => {
    if (!data) return;
    const album = albums.find((a) => a.id === albumId);
    useStore.getState().addToAlbum(data.photoIds, albumId, moving ? from?.id : undefined);
    toast.success(t(moving ? "movedToAlbum" : "addedToAlbum", { album: album ? l(album.name) : "" }));
    close();
  };

  return (
    <Sheet open={open} onClose={close} title={moving ? t("moveToAlbum") : t("addToAlbum")}>
      <div className="space-y-4 px-4 pb-5">
        {from && (
          <Segmented
            label={t("addOrMove")}
            value={move ? "move" : "add"}
            onChange={(v) => setMove(v === "move")}
            options={[
              { value: "move", label: t("moveOutOf", { album: l(from.name) }) },
              { value: "add", label: t("alsoKeepHere") },
            ]}
          />
        )}
        <div className="divide-y overflow-hidden rounded-2xl border">
          {albums
            .filter((a) => a.id !== from?.id)
            .map((a) => {
              const cover = photos.find((p) => p.albums.includes(a.id));
              const inAll = !!data?.photoIds.length && data.photoIds.every((id) => photos.find((p) => p.id === id)?.albums.includes(a.id));
              return (
                <button key={a.id} type="button" onClick={() => add(a.id)} className="flex w-full items-center gap-3 px-3 py-2.5 text-start hover:bg-ge-muted/50">
                  <span className="relative grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg bg-ge-muted">
                    {cover ? <PhotoImage photo={cover} sizes="44px" /> : <Images className="size-5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px]">{l(a.name)}</span>
                    {a.category && <span className="block text-[12px] text-ge-muted-foreground">{t("categoryAlbum")}</span>}
                  </span>
                  {inAll && <Check className="size-5 shrink-0 text-ge-brand" aria-label={t("alreadyInAlbum")} />}
                </button>
              );
            })}
          <button
            type="button"
            onClick={() => data && useStore.getState().openSheet({ type: "albumName", photoIds: data.photoIds })}
            className="flex w-full items-center gap-3 px-3 py-2.5 text-start font-medium text-ge-brand-ink hover:bg-ge-muted/50"
          >
            <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-ge-brand-soft">
              <FolderPlus className="size-5" />
            </span>
            <span className="flex-1 text-[15px]">{t("newAlbum")}</span>
          </button>
        </div>
      </div>
    </Sheet>
  );
}

/* ---------- New album / rename ---------- */

export function AlbumNameSheet() {
  const { open, data, close } = useSheet("albumName");
  const { t, l } = useT();
  const albums = useAlbums();
  const album = albums.find((a) => a.id === data?.albumId);
  const [name, setName] = useState("");
  // Start from the album's current name each time the sheet opens.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setName(album ? l(album.name) : "");
  }

  const submit = () => {
    const n = name.trim();
    if (!n || !data) return;
    const s = useStore.getState();
    if (album) {
      s.renameAlbum(album.id, n);
      toast.success(t("albumRenamed"));
    } else {
      const id = s.createAlbum(n);
      if (data.photoIds?.length) s.addToAlbum(data.photoIds, id);
      toast.success(data.photoIds?.length ? t("addedToAlbum", { album: n }) : t("albumCreated", { album: n }));
    }
    close();
  };

  return (
    <Sheet
      open={open}
      onClose={close}
      title={album ? t("renameAlbum") : t("newAlbum")}
      footer={
        <Btn size="lg" className="w-full" disabled={!name.trim()} onClick={submit}>
          {album ? t("save") : t("createAlbum")}
        </Btn>
      }
    >
      <form
        className="px-4 pb-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("albumName")}
          aria-label={t("albumName")}
          autoFocus
          dir="auto"
          className="h-12 w-full rounded-xl bg-ge-muted px-3 text-[16px] outline-none focus-visible:ring-2 focus-visible:ring-ge-ring"
        />
        {album?.category && <p className="mt-2 text-[12.5px] text-ge-muted-foreground">{t("categoryRenameNote")}</p>}
      </form>
    </Sheet>
  );
}
/* ---------- Upload (mock file picker) ---------- */

export function UploadSheet() {
  const { open, close } = useSheet("upload");
  const { t, l, lang } = useT();
  const accountId = useStore((s) => s.activeAccountId) as AccountId;
  const photos = usePhotos();
  const [selected, setSelected] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const roll = (cameraRoll(accountId) ?? []).filter((r) => !photos.some((p) => p.src === r.src));

  const done = (n: number) => {
    toast.success(n === 1 ? t("uploadedOne") : t("uploaded", { n: num(n, lang) }));
    setSelected([]);
    close();
  };

  const upload = () => {
    const items = roll.filter((r) => selected.includes(r.src));
    useStore.getState().uploadPhotos(items.map(({ src, thumb, dish, credit, category }) => ({ src, thumb, dish, credit, category })));
    done(items.length);
  };

  const fromDevice = (files: FileList | null) => {
    if (!files?.length) return;
    // Object URLs stay in this browser tab; nothing leaves the device.
    const items = Array.from(files)
      .filter((f) => f.type.startsWith("image/"))
      .map((f) => {
        const url = URL.createObjectURL(f);
        const name = f.name.replace(/\.[^.]+$/, "");
        return { src: url, thumb: url, dish: { en: name, ar: name }, credit: { author: "You", link: "" } };
      });
    useStore.getState().uploadPhotos(items);
    done(items.length);
  };

  return (
    <Sheet
      open={open}
      onClose={close}
      title={t("uploadPhotos")}
      footer={
        <Btn size="lg" className="w-full" icon={<ImageUp />} disabled={selected.length === 0} onClick={upload}>
          {t("upload")}
          {selected.length > 0 && ` (${num(selected.length, lang)})`}
        </Btn>
      }
    >
      <div className="pb-4">
        <p className="px-4 pb-2 text-[13px] font-semibold text-ge-muted-foreground">{t("cameraRoll")}</p>
        {roll.length === 0 ? (
          <p className="px-4 pb-4 text-[14px] text-ge-muted-foreground">{t("allCaughtUp")}</p>
        ) : (
          <div className="grid grid-cols-3 gap-[2px] sm:grid-cols-4">
            {roll.map((r) => {
              const on = selected.includes(r.src);
              return (
                <button
                  key={r.src}
                  type="button"
                  aria-pressed={on}
                  aria-label={l(r.dish)}
                  onClick={() => setSelected((s) => (on ? s.filter((x) => x !== r.src) : [...s, r.src]))}
                  className="relative aspect-square bg-ge-muted"
                >
                  <Image unoptimized src={r.thumb} alt="" fill sizes="33vw" className={cn("object-cover transition-transform", on && "scale-[0.94] opacity-80")} />
                  <span
                    className={cn(
                      "absolute end-1.5 bottom-1.5 grid size-[22px] place-items-center rounded-full border-[1.5px] border-white shadow",
                      on ? "bg-ge-brand" : "bg-black/20",
                    )}
                  >
                    {on && <Check className="size-3.5 text-white" strokeWidth={3} />}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <div className="px-4 pt-4">
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => fromDevice(e.target.files)} />
          <Btn variant="outline" className="w-full" icon={<Images />} onClick={() => fileRef.current?.click()}>
            {t("browseFiles")}
          </Btn>
          <p className="mt-2 text-center text-[12px] text-ge-muted-foreground">{t("browseNote")}</p>
        </div>
      </div>
    </Sheet>
  );
}

/* ---------- Post performance ---------- */

export function PerformanceSheet() {
  const { open, data, close } = useSheet("performance");
  const { t, l, lang } = useT();
  const photos = usePhotos();
  const photo = data ? photos.find((p) => p.id === data.photoId) : undefined;
  const published = photos.filter((p) => p.status === "published" && p.metrics);
  const avgReach = published.reduce((s, p) => s + p.metrics!.reach, 0) / Math.max(1, published.length);
  const m = photo?.metrics;

  return (
    <Sheet open={open} onClose={close} title={t("postPerformance")} tall>
      {photo && m && (
        <div className="space-y-5 px-4 pb-6">
          <div className="flex items-center gap-3">
            <span className="relative size-16 shrink-0 overflow-hidden rounded-xl bg-ge-muted">
              <PhotoImage photo={photo} sizes="64px" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[16px] font-semibold">{l(photo.dish)}</p>
              <p className="text-[13px] text-ge-muted-foreground">
                {t("publishedOn", { when: when(photo.publishedAt!, lang) })}
                {photo.postType && ` • ${t(photo.postType)}`}
                {photo.promoted && ` • ${t("promoted")}`}
              </p>
              <div className="mt-1 flex items-center gap-1.5 text-[12px]">
                <Delta value={((m.reach - avgReach) / avgReach) * 100} lang={lang} />
                <span className="text-ge-muted-foreground">{t("performanceVsAvg")}</span>
              </div>
            </div>
          </div>
          <dl className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {(
              [
                ["likes", m.likes],
                ["comments", m.comments],
                ["reach", m.reach],
                ["saves", m.saves],
                ["shares", m.shares],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="rounded-xl bg-ge-muted p-3">
                <dt className="text-[12px] text-ge-muted-foreground">{t(k)}</dt>
                <dd className="text-[18px] font-bold">{compact(v, lang)}</dd>
              </div>
            ))}
          </dl>
          <div>
            <h3 className="mb-3 text-[13px] font-semibold text-ge-muted-foreground">{t("reachOverTime")}</h3>
            <BarChart
              title={t("reachOverTime")}
              values={m.reachByDay}
              labels={m.reachByDay.map((_, i) => t("dayN", { n: num(i + 1, lang) }))}
              tickLabels={m.reachByDay.map((_, i) => num(i + 1, lang))}
              format={(v) => num(v, lang)}
              height={120}
            />
          </div>
          {photo.caption && (
            <p className="rounded-xl border p-3 text-[13.5px] leading-snug whitespace-pre-line text-ge-muted-foreground" dir="auto">
              {l(photo.caption)}
            </p>
          )}
          <p className="text-[11px] text-ge-muted-foreground">
            {time(photo.publishedAt!, lang)} • {t("kuwaitTime")}
          </p>
        </div>
      )}
    </Sheet>
  );
}

/* ---------- Open post: full preview of a ready post ---------- */

export function PostSheet() {
  const { open, data, close } = useSheet("post");
  const { t, lang } = useT();
  const photos = usePhotos();
  const photo = data ? photos.find((p) => p.id === data.photoId) : undefined;
  const [captionLang, setCaptionLang] = useState<Lang>(lang);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setEditing(false);
      setCaptionLang(lang);
    }
  }
  const caption = photo?.caption;
  const s = useStore.getState;

  const startEdit = () => {
    if (!caption) return;
    setText(caption[captionLang]);
    setEditing(true);
  };
  const saveEdit = () => {
    if (!photo || !caption) return;
    s().updateCaption([photo.id], { ...caption, [captionLang]: text });
    setEditing(false);
    toast.success(t("captionSaved"));
  };
  const schedule = () => photo && s().openSheet({ type: "schedule", photoIds: [photo.id], caption });
  const postNow = () => {
    if (!photo || !caption) return;
    s().publishPhotos([photo.id], caption);
    toast.success(t("posted"));
    close();
  };

  const footer = !photo ? null : editing ? (
    <div className="grid grid-cols-2 gap-2">
      <Btn size="lg" variant="secondary" onClick={() => setEditing(false)}>
        {t("cancel")}
      </Btn>
      <Btn size="lg" onClick={saveEdit} disabled={!text.trim()}>
        {t("save")}
      </Btn>
    </div>
  ) : photo.status === "published" ? (
    <div className="grid grid-cols-2 gap-2">
      <Btn size="lg" icon={<BarChart3 />} onClick={() => s().openSheet({ type: "performance", photoId: photo.id })}>
        {t("viewPerformance")}
      </Btn>
      <Btn size="lg" variant="secondary" icon={<PencilLine />} onClick={startEdit}>
        {t("edit")}
      </Btn>
    </div>
  ) : (
    <div className="grid grid-cols-3 gap-2">
      <Btn size="lg" className="col-span-3" icon={<CalendarClock />} onClick={schedule}>
        {photo.status === "scheduled" ? t("reschedule") : t("schedule")}
      </Btn>
      <Btn size="lg" variant="secondary" className="col-span-2" icon={<Send />} onClick={postNow}>
        {t("postNow")}
      </Btn>
      <Btn size="lg" variant="outline" icon={<PencilLine />} onClick={startEdit}>
        {t("edit")}
      </Btn>
    </div>
  );

  return (
    <Sheet open={open} onClose={close} title={t("readyPost")} tall footer={footer}>
      {photo && caption && (
        <div className="space-y-3 pb-4">
          <div className="flex items-center justify-between gap-2 px-4">
            <PostStatus photo={photo} />
            <Segmented
              label={t("language")}
              value={captionLang}
              onChange={(v) => (setCaptionLang(v), setEditing(false))}
              options={[
                { value: "en", label: "EN" },
                { value: "ar", label: "ع" },
              ]}
              className="w-24 shrink-0 [&_button]:h-7"
            />
          </div>
          {editing ? (
            <div className="px-4">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                dir={captionLang === "ar" ? "rtl" : "ltr"}
                lang={captionLang}
                rows={8}
                aria-label={t("caption")}
                autoFocus
                className="w-full resize-none rounded-xl bg-ge-muted px-3 py-2.5 text-[15px] leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ge-ring"
              />
            </div>
          ) : (
            <div className="sm:px-4">
              <PostPreview photos={[photo]} caption={caption[captionLang]} captionLang={captionLang} expanded />
            </div>
          )}
          {photo.status === "scheduled" && photo.scheduledFor && !editing && (
            <p className="flex items-center gap-1.5 px-4 text-[13px] text-ge-muted-foreground">
              <Sparkles className="size-3.5 text-ge-brand" /> {t("scheduledFor", { when: when(photo.scheduledFor, lang) })} • {t("kuwaitTime")}
            </p>
          )}
        </div>
      )}
    </Sheet>
  );
}
