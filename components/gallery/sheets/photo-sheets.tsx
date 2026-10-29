"use client";

import { BarChart3, CalendarClock, Check, FolderPlus, ImageUp, Images, PencilLine, Send, Sparkles } from "lucide-react";
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
import { suggestPostTime } from "@/lib/gallery/suggest-time";
import { uploadGalleryPhotos, type UploadProblem } from "@/lib/gallery/upload-client";
import { GALLERY_ACCEPT, GALLERY_MAX_BATCH } from "@/lib/gallery/uploads";
import { cn } from "@/lib/gallery/utils";
import type { Lang } from "@/mock-data/gallery/types";
import { useSheet } from "./use-sheet";

/* ---------- Schedule ---------- */

export function ScheduleSheet() {
  const { open, data, close } = useSheet("schedule");
  const { t, lang } = useT();
  const photos = usePhotos();
  const insights = useInsights();
  const demo = useStore((s) => s.demo);
  // Real businesses: the draft's suggested time (from their own posts), else tomorrow evening — never the sample insights.
  const suggested = data?.suggested ?? (demo ? suggestedTime(insights) : suggestPostTime(new Date(), "Asia/Kuwait", null).toISOString());
  const options = demo ? [suggested, ...alternativeTimes(insights).filter((x) => x !== suggested)].slice(0, 4) : [suggested];
  const [choice, setChoice] = useState<string>("0");
  const [customDate, setCustomDate] = useState(dayKey(options[0]));
  const [customTime, setCustomTime] = useState("20:30");
  const chosen = data?.photoIds.map((id) => photos.find((p) => p.id === id)).filter((p) => p !== undefined) ?? [];

  const at = choice === "custom" ? new Date(`${customDate}T${customTime}:00+03:00`).toISOString() : options[Number(choice)];

  // Publishing isn't connected yet: the time is kept with the post's draft, and the sheet says so.
  const confirm = async () => {
    if (!data) return;
    const draftId = chosen.find((p) => p.draftId)?.draftId;
    if (draftId && !(await useStore.getState().updateDraft(draftId, { suggestedFor: at }))) return;
    toast.info(draftId ? t("publishingNextTime") : t("publishingNext"));
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
          {t("saveTime")}
        </Btn>
      }
    >
      <div className="space-y-5 px-4 pt-1 pb-4">
        <p className="rounded-xl bg-ge-muted px-3 py-2.5 text-[13px] text-ge-muted-foreground" data-testid="schedule-note">
          {t("scheduleNote")}
        </p>
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
  // Category albums (demo samples) come from the sample data: photos can't be filed into or moved out of them.
  const albums = useAlbums().filter((a) => !a.category);
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

  const [saving, setSaving] = useState(false);
  const submit = async () => {
    const n = name.trim();
    if (!n || !data || saving) return;
    const s = useStore.getState();
    if (album) {
      s.renameAlbum(album.id, n);
      toast.success(t("albumRenamed"));
    } else {
      setSaving(true);
      const id = await s.createAlbum(n, data.photoIds);
      setSaving(false);
      if (!id) return;
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
        <Btn size="lg" className="w-full" disabled={!name.trim() || saving} onClick={submit}>
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
/* ---------- Upload ---------- */

/**
 * Real uploads from the phone or computer (one or many; pick or drop). Photos are made smaller in the browser
 * and sent straight to storage (lib/gallery/upload-client.ts); each one that can't be used says why.
 */
export function UploadSheet() {
  const { open, close } = useSheet("upload");
  const { t, lang } = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const busy = progress !== null;

  const reason = (problem: UploadProblem) =>
    t(problem === "type" ? "uploadReasonType" : problem === "size" ? "uploadReasonSize" : problem === "empty" ? "uploadReasonEmpty" : "uploadReasonFailed");

  const upload = async (list: FileList | File[] | null) => {
    const files = Array.from(list ?? []);
    if (!files.length || busy) return;
    const s = useStore.getState();
    if (s.readOnly) return s.sync?.blocked();
    setProgress({ done: 0, total: Math.min(files.length, GALLERY_MAX_BATCH) });
    try {
      const result = await uploadGalleryPhotos(files, (done, total) => setProgress({ done, total }));
      s.addUploaded(result.photos);
      const n = result.photos.length;
      if (n) toast.success(n === 1 ? t("uploadedOne") : t("uploaded", { n: num(n, lang) }));
      if (result.failures.length === 1) toast.error(t("uploadFailedOne", { name: result.failures[0].name, reason: reason(result.failures[0].problem) }));
      else if (result.failures.length > 1) toast.error(t("uploadFailedN", { n: num(result.failures.length, lang) }));
      if (result.skipped) toast.info(t("uploadSkipped", { n: num(GALLERY_MAX_BATCH, lang) }));
      if (n) close();
    } catch (error) {
      s.sync?.report(error);
    } finally {
      setProgress(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <Sheet open={open} onClose={() => !busy && close()} title={t("uploadPhotos")}>
      <div className="px-4 pb-5">
        <input
          ref={fileRef}
          type="file"
          accept={GALLERY_ACCEPT}
          multiple
          hidden
          onChange={(e) => void upload(e.target.files)}
          data-testid="gallery-file-input"
        />
        <div
          onDragOver={(e) => (e.preventDefault(), setDragging(true))}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => (e.preventDefault(), setDragging(false), void upload(e.dataTransfer.files))}
          className={cn(
            "flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-4 py-8 text-center transition-colors",
            dragging ? "border-ge-brand bg-ge-brand-soft" : "border-ge-foreground/15",
          )}
        >
          <ImageUp className="size-9 text-ge-muted-foreground" strokeWidth={1.5} aria-hidden />
          {progress ? (
            <div className="w-full max-w-xs space-y-2" role="status" aria-live="polite">
              <p className="text-[14px] font-medium">{t("uploadingProgress", { done: num(progress.done, lang), total: num(progress.total, lang) })}</p>
              <div className="h-1.5 overflow-hidden rounded-full bg-ge-muted">
                <div className="h-full rounded-full bg-ge-brand transition-[width]" style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
              </div>
            </div>
          ) : (
            <>
              <Btn icon={<Images />} onClick={() => fileRef.current?.click()}>
                {t("browseFiles")}
              </Btn>
              <p className="hidden text-[13px] text-ge-muted-foreground lg:block">{t("uploadDrop")}</p>
            </>
          )}
        </div>
        <p className="mt-3 text-center text-[12px] text-ge-muted-foreground">{t("browseNote")}</p>
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
  const published = photos.filter((p) => p.status === "published" && p.metrics && !p.metricsPartial);
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
              {!photo.metricsPartial && avgReach > 0 && (
                <div className="mt-1 flex items-center gap-1.5 text-[12px]">
                  <Delta value={((m.reach - avgReach) / avgReach) * 100} lang={lang} />
                  <span className="text-ge-muted-foreground">{t("performanceVsAvg")}</span>
                </div>
              )}
            </div>
          </div>
          <dl className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {(
              [
                ["likes", m.likes],
                ["comments", m.comments],
                // Instagram doesn't share reach, saves and shares for every post: those are left out, never shown as 0.
                ...(photo.metricsPartial
                  ? []
                  : ([
                      ["reach", m.reach],
                      ["saves", m.saves],
                      ["shares", m.shares],
                    ] as const)),
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="rounded-xl bg-ge-muted p-3">
                <dt className="text-[12px] text-ge-muted-foreground">{t(k)}</dt>
                <dd className="text-[18px] font-bold">{compact(v, lang)}</dd>
              </div>
            ))}
          </dl>
          {photo.metricsPartial && <p className="text-[12.5px] text-ge-muted-foreground">{t("metricsPending")}</p>}
          {m.reachByDay.length > 0 && (
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
          )}
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
  // Saved on the server before it says so (the draft is there after a reload).
  const saveEdit = async () => {
    if (!photo || !caption) return;
    if (!(await s().updateCaption([photo.id], { ...caption, [captionLang]: text }))) return;
    setEditing(false);
    toast.success(t("captionSaved"));
  };
  const schedule = () => photo && s().openSheet({ type: "schedule", photoIds: [photo.id], caption, suggested: photo.suggestedFor });
  // Publishing isn't connected yet: say so plainly; the post stays a draft.
  const postNow = () => toast.info(t("publishingNext"));
  // Posted Instagram posts are shown as they are on Instagram; only drafts are edited here.
  const editable = !!photo?.draftId;

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
    <div className="grid grid-cols-1 gap-2">
      <Btn size="lg" icon={<BarChart3 />} onClick={() => s().openSheet({ type: "performance", photoId: photo.id })}>
        {t("viewPerformance")}
      </Btn>
      {photo.permalink && (
        <a href={photo.permalink} target="_blank" rel="noreferrer" className="text-center text-[13.5px] font-semibold text-ge-brand-ink hover:underline">
          {t("viewOnInstagram")}
        </a>
      )}
    </div>
  ) : (
    <div className="grid grid-cols-3 gap-2">
      <Btn size="lg" className="col-span-3" icon={<CalendarClock />} onClick={schedule}>
        {photo.status === "scheduled" ? t("reschedule") : t("schedule")}
      </Btn>
      <Btn size="lg" variant="secondary" className={editable ? "col-span-2" : "col-span-3"} icon={<Send />} onClick={postNow}>
        {t("postNow")}
      </Btn>
      {editable && (
        <Btn size="lg" variant="outline" icon={<PencilLine />} onClick={startEdit}>
          {t("edit")}
        </Btn>
      )}
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
