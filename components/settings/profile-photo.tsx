"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Avatar } from "@/components/shared/avatar";
import { Button } from "@/components/ui/button";
import { apiUpload, type ApiClientError } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/provider";
import { notify } from "@/store/ui-store";
import type { MediaTone } from "@/types";

const MAX_BYTES = 2 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * Instagram "Edit profile" header: avatar, name, and a blue "Change photo"
 * button. Uploads to /api/me/avatar; the server re-renders the shell so the
 * new photo shows everywhere (sidebar, top bar, posts, replies).
 */
export function ProfilePhoto({
  title,
  subtitle,
  avatarUrl,
  initials,
  tone,
}: {
  title: string;
  subtitle: string;
  avatarUrl: string | null;
  initials: string;
  tone: MediaTone;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const upload = useMutation<{ avatarUrl: string }, ApiClientError, File>({
    mutationFn: (file) => {
      const form = new FormData();
      form.append("file", file);
      return apiUpload<{ avatarUrl: string }>("/api/me/avatar", form);
    },
    meta: { handlesErrors: true },
    onSuccess: () => {
      notify.success(t("settings.photo.updated"));
      router.refresh();
    },
    onError: (e) => setError(errorMessage(e, t)),
    onSettled: () => {
      if (preview) URL.revokeObjectURL(preview);
      setPreview(null);
    },
  });

  function onFile(file: File | undefined) {
    if (!file) return;
    if (!TYPES.includes(file.type)) return setError(t("settings.photo.invalidType"));
    if (file.size > MAX_BYTES) return setError(t("settings.photo.tooLarge"));
    setError(null);
    setPreview(URL.createObjectURL(file));
    upload.mutate(file);
  }

  return (
    <section aria-labelledby="profile-photo-title">
      <h2 id="profile-photo-title" className="sr-only">
        {t("settings.photo.title")}
      </h2>
      <div className="flex items-center gap-4 rounded-[20px] bg-secondary-bg p-4">
        <span className="relative">
          <Avatar src={preview ?? avatarUrl} alt={title} initials={initials} tone={tone} size="lg" />
          {upload.isPending && (
            <span className="absolute inset-0 flex items-center justify-center rounded-pill bg-black/40">
              <Loader2 className="size-5 animate-spin text-white" />
            </span>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-title font-bold">{title}</p>
          <p className="truncate text-body text-muted">{subtitle}</p>
        </div>
        <Button onClick={() => inputRef.current?.click()} disabled={upload.isPending}>
          {upload.isPending ? t("settings.photo.uploading") : t("settings.photo.change")}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            onFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      <p className="mt-2 px-1 text-caption text-muted">{t("settings.photo.hint")}</p>
      {error && (
        <p role="alert" className="mt-1 px-1 text-caption text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
