"use client";

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { UPLOAD_LIMITS } from "@/config/onboarding";
import { reportOnboardingEvent } from "@/lib/api/brand";
import { apiFetch, apiUpload, type ApiClientError } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/queries";
import { useI18n } from "@/lib/i18n/provider";
import type { OnboardingStateDto } from "@/types";

const LOGO_TYPES = ["image/jpeg", "image/png", "image/webp"];
/** Optional logo; uploaded straight away (JPG, PNG or WebP up to 2 MB). Shared look with Settings. */
export function LogoCard({ logoUrl, readOnly = false, eventStep = "business" }: { logoUrl: string | null; readOnly?: boolean; eventStep?: "business" | null }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const setLogo = (url: string | null) => {
    queryClient.setQueryData<OnboardingStateDto>(qk.onboarding, (s) => s && { ...s, brand: { ...s.brand, logoUrl: url } });
    queryClient.invalidateQueries({ queryKey: qk.brand });
    queryClient.invalidateQueries({ queryKey: qk.brandColors });
  };
  const upload = useMutation<{ logoUrl: string }, ApiClientError, File>({
    meta: { handlesErrors: true },
    mutationFn: (file) => {
      const form = new FormData();
      form.append("file", file);
      return apiUpload("/api/brand/logo", form);
    },
    onSuccess: ({ logoUrl }) => setLogo(logoUrl),
    onError: (e) => setError(errorMessage(e, t)),
  });
  const remove = useMutation<{ logoUrl: null }, ApiClientError>({
    mutationFn: () => apiFetch("/api/brand/logo", { method: "DELETE" }),
    onSuccess: () => setLogo(null),
  });

  function choose(file: File | undefined) {
    if (!file) return;
    const problem = !LOGO_TYPES.includes(file.type) ? "type" : file.size > UPLOAD_LIMITS.logo ? "size" : null;
    if (problem) {
      setError(t(`onboarding.brand.logoErrors.${problem}`));
      if (eventStep) reportOnboardingEvent(eventStep, "error", { kind: "logo_rejected", reason: problem, size: file.size });
      return;
    }
    setError(null);
    upload.mutate(file);
  }

  const busy = upload.isPending || remove.isPending;
  return (
    <Card className="p-4">
      <div className="flex items-center gap-4">
        <span className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-card border border-border bg-secondary-bg">
          {busy ? (
            <Loader2 className="size-5 animate-spin text-muted" />
          ) : logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- uploaded logo
            <img src={logoUrl} alt={t("brand.basics.logo")} className="size-full object-contain" />
          ) : (
            <ImagePlus className="size-6 text-muted" strokeWidth={1.5} aria-hidden="true" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-title font-bold">
            {t("brand.basics.logo")} <span className="text-caption font-normal text-muted">· {t("common.optional")}</span>
          </h2>
          <p className="text-caption text-muted">{t("onboarding.brand.logoHint")}</p>
        </div>
        {!readOnly && (
          <div className="flex gap-1">
            {logoUrl && (
              <Button variant="ghost" size="icon-sm" onClick={() => remove.mutate()} disabled={busy} aria-label={t("onboarding.brand.removeLogo")}>
                <Trash2 className="size-4" />
              </Button>
            )}
            <Button variant="secondary" onClick={() => input.current?.click()} disabled={busy}>
              {logoUrl ? t("onboarding.brand.replaceLogo") : t("onboarding.brand.uploadLogo")}
            </Button>
          </div>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-caption text-danger">
          {error}
        </p>
      )}
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          choose(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </Card>
  );
}
