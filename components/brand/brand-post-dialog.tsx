"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Camera, Check, Loader2, Trash2, Upload } from "lucide-react";
import { Segmented } from "@/components/settings/segmented";
import { ChipSelect } from "@/components/shared/chip-select";
import { ErrorState, Skeleton } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { POST_PURPOSES, UPLOAD_LIMITS, type EventStepId, type PostPurpose } from "@/config/onboarding";
import { reportOnboardingEvent, useInstagramMedia } from "@/lib/api/brand";
import { apiFetch, apiUpload, type ApiClientError } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { BrandPostDto, PickableMediaDto } from "@/types";
import { BrandMedia } from "./brand-post-grid";

type Source = "instagram" | "upload";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const VIDEO_TYPES = ["video/mp4"];

/**
 * Add or edit one brand post: pick it from the connected Instagram account or
 * upload a picture/short video, then say what it's for. Used by onboarding
 * step 4 and Settings → Brand profile.
 */
export function BrandPostDialog({
  open,
  onOpenChange,
  post,
  slot,
  connected,
  usedMediaIds,
  onSaved,
  onRemoved,
  eventStep,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null → add a new post. */
  post: BrandPostDto | null;
  /** 1-based position, for the title ("Post 3"). */
  slot: number;
  connected: boolean;
  /** Instagram posts already used by other brand posts. */
  usedMediaIds: string[];
  onSaved: (post: BrandPostDto) => void;
  onRemoved?: (id: string) => void;
  /** Onboarding step to attach client-side errors to (wizard only). */
  eventStep?: EventStepId;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(92dvh,760px)] max-w-[560px] flex-col">
        <DialogHeader>
          <DialogTitle>{post ? t("brand.postDialog.editTitle", { n: slot }) : t("brand.postDialog.addTitle", { n: slot })}</DialogTitle>
          <DialogDescription className="sr-only">{t("brand.postDialog.description")}</DialogDescription>
        </DialogHeader>
        {open && (
          <PostForm
            key={post?.id ?? "new"}
            post={post}
            connected={connected}
            usedMediaIds={usedMediaIds}
            eventStep={eventStep}
            onDone={(saved) => {
              onSaved(saved);
              onOpenChange(false);
            }}
            onRemoved={
              onRemoved &&
              ((id) => {
                onRemoved(id);
                onOpenChange(false);
              })
            }
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PostForm({
  post,
  connected,
  usedMediaIds,
  eventStep,
  onDone,
  onRemoved,
  onCancel,
}: {
  post: BrandPostDto | null;
  connected: boolean;
  usedMediaIds: string[];
  eventStep?: EventStepId;
  onDone: (post: BrandPostDto) => void;
  onRemoved?: (id: string) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [source, setSource] = useState<Source>(post?.source ?? (connected ? "instagram" : "upload"));
  const [picked, setPicked] = useState<PickableMediaDto | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [caption, setCaption] = useState(post?.caption ?? "");
  const [purpose, setPurpose] = useState<PostPurpose | null>(post?.purpose ?? null);
  const [purposeOther, setPurposeOther] = useState(post?.purposeOther ?? "");
  const [purposeNote, setPurposeNote] = useState(post?.purposeNote ?? "");
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const media = useInstagramMedia(connected && source === "instagram");

  // Object URLs for the local preview are released when replaced or on close.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const save = useMutation<BrandPostDto, ApiClientError>({
    meta: { handlesErrors: true },
    mutationFn: async () => {
      const fields = { purpose: purpose!, purposeOther: purpose === "other" ? purposeOther.trim() : null, purposeNote: purposeNote.trim() || null };
      if (!post) {
        if (source === "upload" && file) {
          const form = new FormData();
          form.append("file", file);
          form.append("caption", caption.trim());
          form.append("purpose", fields.purpose);
          if (fields.purposeOther) form.append("purposeOther", fields.purposeOther);
          if (fields.purposeNote) form.append("purposeNote", fields.purposeNote);
          return apiUpload<BrandPostDto>("/api/brand/posts", form);
        }
        return apiFetch<BrandPostDto>("/api/brand/posts", { method: "POST", body: { igMediaId: picked!.id, caption: caption.trim(), ...fields } });
      }
      let current = post;
      if (source === "upload" && file) {
        const form = new FormData();
        form.append("file", file);
        current = await apiUpload<BrandPostDto>(`/api/brand/posts/${post.id}/media`, form);
      } else if (source === "instagram" && picked && picked.id !== post.igMediaId) {
        current = await apiFetch<BrandPostDto>(`/api/brand/posts/${post.id}/media`, { method: "PUT", body: { igMediaId: picked.id } });
      }
      return apiFetch<BrandPostDto>(`/api/brand/posts/${current.id}`, { method: "PATCH", body: { caption: caption.trim(), ...fields } });
    },
    onSuccess: onDone,
    onError: (e) => setError(e.code === "instagram_not_connected" ? t("brand.postDialog.needsInstagram") : errorMessage(e, t)),
  });

  const remove = useMutation<{ id: string }, ApiClientError>({
    meta: { handlesErrors: true },
    mutationFn: () => apiFetch(`/api/brand/posts/${post!.id}`, { method: "DELETE" }),
    onSuccess: ({ id }) => onRemoved?.(id),
    onError: (e) => setError(errorMessage(e, t)),
  });

  function chooseFile(next: File | undefined) {
    if (!next) return;
    const isImage = IMAGE_TYPES.includes(next.type);
    const isVideo = VIDEO_TYPES.includes(next.type);
    let problem: string | null = null;
    if (!isImage && !isVideo) problem = "type";
    else if (isImage && next.size > UPLOAD_LIMITS.image) problem = "image_size";
    else if (isVideo && next.size > UPLOAD_LIMITS.video) problem = "video_size";
    if (problem) {
      setError(t(`brand.postDialog.fileErrors.${problem}`));
      if (eventStep) reportOnboardingEvent(eventStep, "error", { kind: "upload_rejected", reason: problem, size: next.size, type: next.type || "unknown" });
      return;
    }
    setError(null);
    setFile(next);
    setPreview(URL.createObjectURL(next));
  }

  function pick(item: PickableMediaDto) {
    // Use the post's own caption unless the person already wrote one.
    if (!caption.trim() || caption === picked?.caption) setCaption(item.caption);
    setPicked(item);
  }

  const hasNewMedia = source === "upload" ? Boolean(file) : Boolean(picked);
  const hasMedia = hasNewMedia || (post !== null && source === post.source);
  const otherMissing = purpose === "other" && !purposeOther.trim();
  const problems = [!hasMedia && "media", !purpose && "purpose", otherMissing && "purposeOther"].filter(Boolean) as string[];

  function submit() {
    if (problems.length) {
      setShowErrors(true);
      if (eventStep) reportOnboardingEvent(eventStep, "error", { kind: "post_form", missing: problems });
      return;
    }
    setError(null);
    save.mutate();
  }

  const busy = save.isPending || remove.isPending;
  const currentUrl = post && source === post.source ? post.mediaUrl : null;

  return (
    <>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        <div className="flex justify-center">
          <Segmented<Source>
            label={t("brand.postDialog.source")}
            value={source}
            onChange={(next) => {
              setSource(next);
              setError(null);
            }}
            options={[
              { value: "instagram", label: t("brand.postDialog.fromInstagram") },
              { value: "upload", label: t("brand.postDialog.upload") },
            ]}
          />
        </div>

        {source === "instagram" ? (
          !connected ? (
            <div className="flex flex-col items-center rounded-card bg-secondary-bg px-4 py-6 text-center">
              <Camera className="mb-2 size-7" strokeWidth={1.5} aria-hidden="true" />
              <p className="text-body font-semibold">{t("brand.postDialog.notConnectedTitle")}</p>
              <p className="mt-1 text-caption text-muted">{t("brand.postDialog.notConnectedBody")}</p>
              <Button variant="secondary" className="mt-3" onClick={() => setSource("upload")}>
                {t("brand.postDialog.uploadInstead")}
              </Button>
            </div>
          ) : media.isPending ? (
            <div className="grid grid-cols-3 gap-1">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="aspect-square rounded-none" />
              ))}
            </div>
          ) : media.isError ? (
            <ErrorState error={media.error} onRetry={() => media.refetch()} />
          ) : media.data.length === 0 ? (
            <p className="rounded-card bg-secondary-bg px-4 py-6 text-center text-body text-muted">{t("brand.postDialog.noMedia")}</p>
          ) : (
            <div>
              <p className={cn("mb-2 text-caption", showErrors && !hasMedia ? "text-danger" : "text-muted")}>{t("brand.postDialog.pickHint")}</p>
              <ul className="grid max-h-72 grid-cols-3 gap-1 overflow-y-auto" role="listbox" aria-label={t("brand.postDialog.fromInstagram")}>
                {media.data.map((item) => {
                  const used = usedMediaIds.includes(item.id) && item.id !== post?.igMediaId;
                  const selected = picked ? picked.id === item.id : post?.source === "instagram" && post.igMediaId === item.id;
                  return (
                    <li key={item.id} role="option" aria-selected={selected} aria-disabled={used || undefined}>
                      <button
                        type="button"
                        disabled={used}
                        onClick={() => pick(item)}
                        className={cn("relative block w-full outline-none focus-visible:ring-2 focus-visible:ring-primary", used && "opacity-40")}
                        title={item.caption}
                      >
                        <BrandMedia url={item.mediaUrl} type={item.mediaType} className="aspect-square w-full" />
                        {selected && (
                          <span className="absolute inset-0 flex items-start justify-end bg-black/25 p-1.5 ring-3 ring-primary ring-inset">
                            <span className="flex size-6 items-center justify-center rounded-pill bg-primary text-white">
                              <Check className="size-4" />
                            </span>
                          </span>
                        )}
                        {used && (
                          <span className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-center text-[11px] font-semibold text-white">{t("brand.postDialog.alreadyAdded")}</span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )
        ) : (
          <div>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className={cn(
                "relative flex w-full flex-col items-center justify-center overflow-hidden rounded-card border border-dashed bg-secondary-bg text-center transition-colors hover:bg-hover",
                showErrors && !hasMedia ? "border-danger" : "border-border",
                preview || currentUrl ? "aspect-square max-h-72" : "px-4 py-8",
              )}
            >
              {preview && file ? (
                file.type.startsWith("video/") ? (
                  <video src={preview} muted playsInline controls className="size-full object-contain" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- local blob: preview
                  <img src={preview} alt="" className="size-full object-contain" />
                )
              ) : currentUrl && post ? (
                <BrandMedia url={currentUrl} type={post.mediaType} className="size-full" />
              ) : (
                <>
                  <Upload className="mb-2 size-7" strokeWidth={1.5} aria-hidden="true" />
                  <span className="text-body font-semibold">{t("brand.postDialog.chooseFile")}</span>
                  <span className="mt-1 text-caption text-muted">{t("brand.postDialog.fileHint")}</span>
                </>
              )}
            </button>
            {(preview || currentUrl) && (
              <p className="mt-2 flex items-center justify-between gap-2 text-caption text-muted">
                <span className="truncate">{file ? file.name : t("brand.postDialog.currentFile")}</span>
                <Button variant="link" size="sm" onClick={() => fileInput.current?.click()}>
                  {t("brand.postDialog.replaceFile")}
                </Button>
              </p>
            )}
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp,video/mp4"
              className="hidden"
              onChange={(e) => {
                chooseFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
        )}

        <div>
          <label htmlFor="brand-post-caption" className="mb-1.5 block text-body font-semibold">
            {t("brand.postDialog.caption")}
          </label>
          <Textarea id="brand-post-caption" value={caption} onChange={(e) => setCaption(e.target.value)} rows={3} dir="auto" maxLength={2200} placeholder={t("brand.postDialog.captionPlaceholder")} />
        </div>

        <div>
          <ChipSelect<PostPurpose>
            label={t("brand.postDialog.purpose")}
            hint={t("brand.postDialog.purposeHint")}
            value={purpose}
            onChange={setPurpose}
            invalid={showErrors && !purpose}
            options={POST_PURPOSES.map((p) => ({ value: p, label: t(`purposes.${p}`) }))}
          />
          {purpose === "other" && (
            <Input
              value={purposeOther}
              onChange={(e) => setPurposeOther(e.target.value)}
              maxLength={60}
              placeholder={t("brand.postDialog.otherPlaceholder")}
              aria-label={t("brand.postDialog.otherLabel")}
              aria-invalid={(showErrors && otherMissing) || undefined}
              className={cn("mt-2.5", showErrors && otherMissing && "border-danger")}
            />
          )}
        </div>

        <div>
          <label htmlFor="brand-post-note" className="mb-1.5 block text-body font-semibold">
            {t("brand.postDialog.note")} <span className="font-normal text-muted">· {t("common.optional")}</span>
          </label>
          <Input id="brand-post-note" value={purposeNote} onChange={(e) => setPurposeNote(e.target.value)} maxLength={140} placeholder={t("brand.postDialog.notePlaceholder")} />
        </div>

        {showErrors && problems.length > 0 && (
          <p role="alert" className="text-caption text-danger">
            {t("brand.postDialog.missing", { fields: problems.map((p) => t(`brand.postDialog.missingFields.${p}`)).join(", ") })}
          </p>
        )}
        {error && (
          <p role="alert" className="text-caption text-danger">
            {error}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-separator px-4 py-3">
        {post && onRemoved && (
          <Button variant="danger" onClick={() => remove.mutate()} disabled={busy}>
            {remove.isPending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            {t("common.remove")}
          </Button>
        )}
        <Button variant="secondary" className="ms-auto" onClick={onCancel} disabled={busy}>
          {t("common.cancel")}
        </Button>
        <Button onClick={submit} disabled={busy} aria-busy={save.isPending}>
          {save.isPending && <Loader2 className="size-4 animate-spin" />}
          {save.isPending && source === "upload" && file ? t("brand.postDialog.uploading") : t("common.save")}
        </Button>
      </div>
    </>
  );
}
