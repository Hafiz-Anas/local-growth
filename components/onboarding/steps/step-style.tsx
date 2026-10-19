"use client";

import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, ImagePlus, Loader2, X } from "lucide-react";
import { BrandMedia } from "@/components/brand/brand-post-grid";
import { StyleSummaryField } from "@/components/onboarding/style-summary";
import { Skeleton } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { STYLE_PHOTO_MAX, UPLOAD_LIMITS } from "@/config/onboarding";
import { reportOnboardingEvent, useInstagramMedia } from "@/lib/api/brand";
import { apiFetch, apiUpload, type ApiClientError } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { notify } from "@/store/ui-store";
import type { OnboardingStateDto, StylePhoto } from "@/types";
import { StepFrame } from "../step-frame";
import { useWizard } from "../wizard-context";

const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];

/**
 * Step 2 — Your style: up to 5 of their best posts from the Instagram grid, photos from the phone,
 * or both. On Continue the AI reads them in the background (the wizard moves on at once) and keeps
 * a style guide; the owner later sees one editable line ("Warm colors, close-up, top-down angle").
 * Skipped (or nothing picked) → the most recent posts are used later.
 */
export function StepStyle() {
  const { t } = useI18n();
  const { state, go, skip, moving, setState } = useWizard();
  const connected = state.instagram.status !== "disconnected";
  const media = useInstagramMedia(connected);
  const [picked, setPicked] = useState<StylePhoto[]>(() => state.style?.photos ?? []);
  const [uploading, setUploading] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const full = picked.length >= STYLE_PHOTO_MAX;

  const isPicked = (id: string) => picked.some((p) => p.source === "instagram" && p.igMediaId === id);
  const togglePost = (id: string) =>
    setPicked((list) => (isPicked(id) ? list.filter((p) => !(p.source === "instagram" && p.igMediaId === id)) : list.length < STYLE_PHOTO_MAX ? [...list, { source: "instagram", igMediaId: id }] : list));

  async function uploadFiles(files: FileList | null) {
    const room = STYLE_PHOTO_MAX - picked.length;
    const list = [...(files ?? [])].slice(0, room);
    if (fileInput.current) fileInput.current.value = "";
    for (const file of list) {
      if (!ACCEPTED.includes(file.type) || file.size > UPLOAD_LIMITS.image) {
        notify.error(t("onboarding.style.badFile"));
        reportOnboardingEvent("style", "error", { kind: "upload_rejected", type: file.type, size: file.size });
        continue;
      }
      setUploading((n) => n + 1);
      try {
        const form = new FormData();
        form.append("file", file);
        const { url } = await apiUpload<{ url: string }>("/api/onboarding/style/photos", form);
        setPicked((current) => (current.length < STYLE_PHOTO_MAX ? [...current, { source: "upload", url }] : current));
      } catch (error) {
        notify.error(errorMessage(error as ApiClientError, t));
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  const save = useMutation<OnboardingStateDto, ApiClientError, StylePhoto[]>({
    meta: { handlesErrors: true },
    mutationFn: (photos) => apiFetch("/api/onboarding/style", { method: "PUT", body: { photos } }),
    onSuccess: async (next) => {
      setState(next);
      await go("goals", "forward");
    },
    onError: (e) => notify.error(errorMessage(e, t)),
  });

  const uploads = picked.filter((p): p is Extract<StylePhoto, { source: "upload" }> => p.source === "upload");
  const guide = state.style;

  return (
    <StepFrame
      step="style"
      title={t("onboarding.steps.style.title")}
      helper={t("onboarding.steps.style.helper")}
      onBack={() => go("business", "back")}
      onSkip={() => skip("style")}
      // Nothing picked is the same as skipping: the recent posts are read later.
      primary={{ label: t("onboarding.continue"), onClick: () => (picked.length ? save.mutate(picked) : skip("style")), disabled: uploading > 0, busy: moving || save.isPending }}
      blockedNote={uploading > 0 ? t("onboarding.style.uploading") : null}
      reportContext={{ picked: picked.length, uploads: uploads.length, connected }}
    >
      <p className="mb-4 text-body font-semibold" aria-live="polite" data-testid="style-count">
        {t("onboarding.style.count", { n: picked.length, max: STYLE_PHOTO_MAX })}
      </p>

      {guide?.summary && (
        <div className="mb-6">
          <StyleSummaryField guide={guide} />
        </div>
      )}

      <section aria-labelledby="style-uploads">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 id="style-uploads" className="text-body font-semibold">
            {t("onboarding.style.fromPhone")}
          </h2>
          <Button variant="secondary" size="sm" onClick={() => fileInput.current?.click()} disabled={full || uploading > 0} data-testid="style-upload">
            {uploading > 0 ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
            {t("onboarding.style.upload")}
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPTED.join(",")}
            multiple
            hidden
            onChange={(e) => uploadFiles(e.target.files)}
            data-testid="style-file-input"
            aria-label={t("onboarding.style.upload")}
          />
        </div>
        {uploads.length > 0 ? (
          <ul className="grid grid-cols-3 gap-1 sm:grid-cols-5">
            {uploads.map((p) => (
              <li key={p.url} className="relative">
                <BrandMedia url={p.url} type="image" alt={t("onboarding.style.uploadedPhoto")} className="aspect-square" />
                <button
                  type="button"
                  onClick={() => setPicked((list) => list.filter((x) => !(x.source === "upload" && x.url === p.url)))}
                  className="absolute end-1 top-1 rounded-pill bg-black/60 p-1 text-white hover:bg-black/80"
                  aria-label={t("onboarding.style.removePhoto")}
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-caption text-muted">{t("onboarding.style.uploadHint")}</p>
        )}
      </section>

      {connected && (
        <section className="mt-8" aria-labelledby="style-grid">
          <h2 id="style-grid" className="mb-2 text-body font-semibold">
            {t("onboarding.style.fromInstagram")}
          </h2>
          {media.isPending ? (
            <div className="grid grid-cols-3 gap-1">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="aspect-square rounded-none" />
              ))}
            </div>
          ) : media.isError || media.data.length === 0 ? (
            <p className="text-caption text-muted">{t("onboarding.style.noPosts")}</p>
          ) : (
            <ul className="grid grid-cols-3 gap-1" data-testid="style-grid">
              {media.data.map((m) => {
                const on = isPicked(m.id);
                const n = picked.findIndex((p) => p.source === "instagram" && p.igMediaId === m.id) + 1;
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => togglePost(m.id)}
                      disabled={!on && full}
                      aria-pressed={on}
                      aria-label={t("onboarding.style.pickPost", { caption: m.caption.slice(0, 40) || m.id })}
                      className={cn("relative block w-full disabled:opacity-40", on && "outline-2 -outline-offset-2 outline-primary")}
                    >
                      <BrandMedia url={m.mediaUrl} type={m.mediaType} className="aspect-square" />
                      {on && (
                        <span className="absolute end-1.5 top-1.5 flex size-6 items-center justify-center rounded-pill bg-primary text-caption font-bold text-white">
                          {n || <Check className="size-3.5" />}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </StepFrame>
  );
}
