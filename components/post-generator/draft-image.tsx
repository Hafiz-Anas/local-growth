"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, RefreshCw, Sparkles, Trash2, Upload } from "lucide-react";
import { apiFetch, apiUpload, ApiClientError } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { useAction } from "@/lib/api/queries";
import { useI18n } from "@/lib/i18n/provider";
import { checkImageFile, POST_IMAGE_ACCEPT, POST_IMAGE_MAX_BYTES } from "@/lib/uploads/sniff";
import { cn } from "@/lib/utils";
import type { PostDraftDto } from "@/types";

type Busy = { id: string; kind: "generate" | "upload" | "remove" };

/** Reasons the server gives for "image_unavailable" (lib/services/images/errors.ts). */
const REASONS = new Set([
  "daily_limit",
  "rate_limited",
  "billing",
  "invalid_key",
  "not_configured",
  "region",
  "model_unavailable",
  "blocked",
  "no_image",
  "request_rejected",
  "unavailable",
]);

const MAX_MB = POST_IMAGE_MAX_BYTES / (1024 * 1024);

/**
 * Image actions for Post Generator drafts: AI "Generate image" / "Regenerate",
 * "Upload image" / "Replace" from the device, and "Remove". One image per
 * draft — each replaces the other. Errors stay next to the post that failed.
 */
export function useDraftImages(onSaved: (draft: PostDraftDto) => void) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<Busy | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const target = useRef<string | null>(null);

  const explain = (e: ApiClientError) => {
    if (e.code === "image_unavailable") {
      const reason = Array.isArray(e.details) ? (e.details as Array<{ message?: string }>)[0]?.message : undefined;
      return t("generator.image.unavailable", {
        reason: t(`generator.image.reasons.${reason && REASONS.has(reason) ? reason : "unavailable"}`),
      });
    }
    if (e.code === "payload_too_large") return t("generator.image.errors.size", { max: MAX_MB });
    if (e.code === "unsupported_media_type") return t("generator.image.errors.type");
    return errorMessage(e, t);
  };

  const common = {
    meta: { handlesErrors: true },
    onSuccess: (draft: PostDraftDto) => {
      setError(null);
      onSaved(draft);
    },
    onSettled: () => setBusy(null),
  };
  const generate = useAction<PostDraftDto, string>({
    ...common,
    mutationFn: (id) => apiFetch(`/api/post-drafts/${id}/image/generate`, { method: "POST" }),
    onMutate: (id) => setBusy({ id, kind: "generate" }),
    onError: (e, id) => setError({ id, message: explain(e) }),
  });
  const upload = useAction<PostDraftDto, { id: string; file: File }>({
    ...common,
    mutationFn: ({ id, file }) => {
      const form = new FormData();
      form.append("file", file);
      return apiUpload(`/api/post-drafts/${id}/image`, form);
    },
    onMutate: ({ id }) => setBusy({ id, kind: "upload" }),
    onError: (e, { id }) => setError({ id, message: explain(e) }),
  });
  const remove = useAction<PostDraftDto, string>({
    ...common,
    mutationFn: (id) => apiFetch(`/api/post-drafts/${id}/image`, { method: "DELETE" }),
    onMutate: (id) => setBusy({ id, kind: "remove" }),
    onError: (e, id) => setError({ id, message: explain(e) }),
  });

  function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const id = target.current;
    event.target.value = "";
    if (!file || !id) return;
    const problem = checkImageFile(file);
    if (problem) {
      setError({
        id,
        message:
          problem === "size" ? t("generator.image.errors.size", { max: MAX_MB }) : problem === "empty" ? t("generator.image.errors.empty") : t("generator.image.errors.type"),
      });
      return;
    }
    upload.mutate({ id, file });
  }

  return {
    busy,
    errorFor: (id: string) => (error?.id === id ? error.message : null),
    generate: (id: string) => generate.mutate(id),
    remove: (id: string) => remove.mutate(id),
    pickFile: (id: string) => {
      target.current = id;
      input.current?.click();
    },
    fileInput: <input ref={input} type="file" accept={POST_IMAGE_ACCEPT} className="hidden" onChange={onFile} aria-hidden="true" tabIndex={-1} />,
  };
}

export type DraftImages = ReturnType<typeof useDraftImages>;

/** On the post's media: the AI label for generated images, a spinner while working. Uploaded images get no label. */
export function DraftImageOverlay({ draft, images }: { draft: PostDraftDto; images: DraftImages }) {
  const { t } = useI18n();
  const working = images.busy?.id === draft.id && images.busy.kind !== "remove";
  return (
    <>
      {draft.image?.source === "generated" && (
        <span className="absolute start-2 bottom-2 inline-flex max-w-[calc(100%-16px)] items-center gap-1 rounded-pill bg-black/65 px-2 py-1 text-[11px] font-semibold text-white">
          <Sparkles className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{t("generator.image.aiLabel")}</span>
        </span>
      )}
      {working && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/45 text-white" role="status">
          <Loader2 className="size-7 animate-spin" aria-hidden="true" />
          <span className="text-caption font-semibold">{images.busy?.kind === "generate" ? t("generator.image.generating") : t("generator.image.uploading")}</span>
        </div>
      )}
    </>
  );
}

/** The image actions under the caption. */
export function DraftImageToolbar({ draft, images, disabled }: { draft: PostDraftDto; images: DraftImages; disabled?: boolean }) {
  const { t } = useI18n();
  const busy = images.busy?.id === draft.id;
  const off = disabled || busy;
  const error = images.errorFor(draft.id);
  const source = draft.image?.source ?? null;
  return (
    <div className="px-3 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <ToolButton
          icon={source === "generated" ? RefreshCw : Sparkles}
          label={source === "generated" ? t("generator.image.regenerate") : t("generator.image.generate")}
          onClick={() => images.generate(draft.id)}
          disabled={off}
        />
        <ToolButton
          icon={source ? Upload : ImagePlus}
          label={source === "uploaded" ? t("generator.image.replace") : t("generator.image.upload")}
          onClick={() => images.pickFile(draft.id)}
          disabled={off}
        />
        {source && <ToolButton icon={Trash2} label={t("generator.image.remove")} onClick={() => images.remove(draft.id)} disabled={off} />}
      </div>
      {error ? (
        <p role="alert" className="mt-1.5 text-caption text-danger">
          {error}
        </p>
      ) : (
        !source && <p className="mt-1 text-caption text-muted">{t("generator.image.hint")}</p>
      )}
    </div>
  );
}

function ToolButton({ icon: Icon, label, onClick, disabled }: { icon: typeof Sparkles; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-button bg-button-secondary px-2.5 text-caption font-semibold text-foreground transition-colors hover:bg-button-secondary-hover disabled:opacity-50",
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      {label}
    </button>
  );
}
