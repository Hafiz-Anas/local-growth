"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Flag, Loader2 } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { EventStepId } from "@/config/onboarding";
import { apiFetch, type ApiClientError } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/provider";
import { notify } from "@/store/ui-store";

/**
 * "Report a problem" on every wizard step. Saves the note with the step and
 * screenshot-free context (language, theme, screen size, page, step state).
 */
export function ReportProblem({ step, context }: { step: EventStepId; context?: Record<string, unknown> }) {
  const { t, locale } = useI18n();
  const { resolvedTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const send = useMutation<{ id: string }, ApiClientError>({
    meta: { handlesErrors: true },
    mutationFn: () =>
      apiFetch("/api/onboarding/feedback", {
        method: "POST",
        body: {
          step,
          note: note.trim(),
          context: {
            ...context,
            locale,
            theme: resolvedTheme ?? null,
            viewport: `${window.innerWidth}×${window.innerHeight}`,
            path: window.location.pathname,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
        },
      }),
    onSuccess: () => {
      notify.success(t("onboarding.report.sent"));
      setNote("");
      setOpen(false);
    },
    onError: (e) => setError(errorMessage(e, t)),
  });

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 text-caption text-muted hover:text-foreground hover:underline">
        <Flag className="size-3.5" aria-hidden="true" />
        {t("onboarding.report.link")}
      </button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          setError(null);
        }}
      >
        <DialogContent className="max-w-[440px]">
          <DialogHeader>
            <DialogTitle>{t("onboarding.report.title")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 p-4">
            <DialogDescription>{t("onboarding.report.body")}</DialogDescription>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={5} maxLength={2000} dir="auto" placeholder={t("onboarding.report.placeholder")} aria-label={t("onboarding.report.title")} autoFocus />
            <p className="text-caption text-muted">{t("onboarding.report.privacy")}</p>
            {error && (
              <p role="alert" className="text-caption text-danger">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button onClick={() => send.mutate()} disabled={!note.trim() || send.isPending}>
                {send.isPending && <Loader2 className="size-4 animate-spin" />}
                {t("onboarding.report.send")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
