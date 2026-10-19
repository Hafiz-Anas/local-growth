"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch, type ApiClientError } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/queries";
import { useI18n } from "@/lib/i18n/provider";
import { notify } from "@/store/ui-store";
import type { StyleGuideDto } from "@/types";

const SUMMARY_MAX = 80;

/**
 * The photo style guide as the owner sees it: one line ("Warm colors, close-up, top-down angle") they
 * can change. While the AI is still reading the photos it says so; if it couldn't, they can write the
 * line themselves. Plain useMutation: used in the wizard (no ActiveClientProvider) and Settings.
 */
export function StyleSummaryField({ guide, readOnly = false }: { guide: StyleGuideDto | null; readOnly?: boolean }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? guide?.summary ?? "";
  const building = guide?.status === "building" && !guide.summary;

  const save = useMutation<StyleGuideDto, ApiClientError, string>({
    meta: { handlesErrors: true },
    mutationFn: (summary) => apiFetch("/api/brand/style", { method: "PATCH", body: { summary } }),
    onSuccess: (next) => {
      setDraft(null);
      queryClient.setQueryData(qk.styleGuide, next);
      queryClient.setQueryData(qk.onboarding, (s: { style?: StyleGuideDto | null } | undefined) => (s ? { ...s, style: next } : s));
      notify.success(t("onboarding.style.saved"));
    },
    onError: (e) => notify.error(errorMessage(e, t)),
  });

  return (
    <div className="rounded-panel border border-border p-4" data-testid="style-summary">
      <label htmlFor="style-summary" className="mb-1 flex items-center gap-1.5 text-body font-semibold">
        <Camera className="size-4" aria-hidden="true" />
        {t("onboarding.style.summaryLabel")}
      </label>
      <p className="mb-2 text-caption text-muted" aria-live="polite">
        {building ? (
          <span className="inline-flex items-center gap-1.5">
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            {t("onboarding.style.reading")}
          </span>
        ) : guide?.status === "failed" && !guide.summary ? (
          t("onboarding.style.failed")
        ) : (
          t("onboarding.style.summaryHint")
        )}
      </p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(value.trim());
        }}
      >
        <Input
          id="style-summary"
          value={value}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={SUMMARY_MAX}
          placeholder={t("onboarding.style.summaryPlaceholder")}
          disabled={readOnly}
          dir="auto"
          className="min-w-0 flex-1"
        />
        {!readOnly && (
          <Button type="submit" variant="secondary" size="md" disabled={draft === null || save.isPending}>
            {save.isPending && <Loader2 className="size-4 animate-spin" />}
            {t("common.save")}
          </Button>
        )}
      </form>
    </div>
  );
}
