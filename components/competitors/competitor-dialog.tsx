"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { qk, useAction } from "@/lib/api/queries";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { notify } from "@/store/ui-store";
import type { CompetitorDto } from "@/types";
import { HANDLE_PATTERN, competitorName, normalizeHandle } from "./helpers";

/** Add (competitor = null) or edit a tracked competitor: handle, display name, note. */
export function CompetitorDialog({
  open,
  onOpenChange,
  competitor,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  competitor: CompetitorDto | null;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{competitor ? t("competitors.form.editTitle") : t("competitors.form.addTitle")}</DialogTitle>
          <DialogDescription className="sr-only">{t("competitors.form.description")}</DialogDescription>
        </DialogHeader>
        {/* Mounted only while open (and keyed), so every opening starts from fresh values. */}
        {open && <CompetitorForm key={competitor?.id ?? "new"} competitor={competitor} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

type FieldErrors = { handle?: string; form?: string; needsInstagram?: boolean };

function CompetitorForm({ competitor, onDone }: { competitor: CompetitorDto | null; onDone: () => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [handle, setHandle] = useState(competitor?.handle ?? "");
  const [displayName, setDisplayName] = useState(competitor?.displayName ?? "");
  const [note, setNote] = useState(competitor?.note ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});
  const editing = Boolean(competitor);

  const save = useAction<CompetitorDto, { handle: string; displayName: string | null; note: string | null }>({
    mutationFn: (body) =>
      competitor
        ? apiFetch<CompetitorDto>(`/api/competitors/${competitor.id}`, { method: "PATCH", body })
        : apiFetch<CompetitorDto>("/api/competitors", { method: "POST", body }),
    meta: { handlesErrors: true },
    onSuccess: (saved) => {
      queryClient.setQueryData<CompetitorDto[]>(qk.competitors, (list) =>
        competitor ? list?.map((c) => (c.id === saved.id ? saved : c)) : [...(list ?? []), saved],
      );
      queryClient.setQueryData([...qk.competitors, saved.id], saved);
      notify.success(
        competitor ? t("competitors.form.updated", { name: competitorName(saved) }) : t("competitors.added", { handle: saved.handle }),
      );
      onDone();
    },
    onError: (error) => setErrors(errorsFor(error)),
  });

  /** Server errors → inline field messages where they belong to a field. */
  function errorsFor(error: ApiClientError): FieldErrors {
    const reason = Array.isArray(error.details) ? (error.details as Array<{ path?: string; message?: string }>).find((d) => d.path === "handle")?.message : undefined;
    if (error.code === "instagram_not_connected") return { form: t("competitors.form.connectFirst"), needsInstagram: true };
    if (reason === "already_tracked") return { handle: t("competitors.form.alreadyTracked", { handle: normalizeHandle(handle) }) };
    if (reason === "own_account") return { handle: t("competitors.form.ownAccount") };
    if (reason === "no_such_account") return { handle: t("competitors.form.noSuchAccount") };
    if (reason === "private_account") return { handle: t("onboarding.competitors.reasons.private") };
    if (reason === "not_business") return { handle: t("onboarding.competitors.reasons.not_business") };
    if (reason === "limit_reached") {
      const max = (error.details as Array<{ path?: string; message?: string }>).find((d) => d.path === "max")?.message ?? "5";
      return { form: t("competitors.form.limitReached", { max }) };
    }
    if (error.code === "validation_error") return { handle: t("competitors.invalidHandle") };
    return { form: errorMessage(error, t) };
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const value = normalizeHandle(handle);
    if (!HANDLE_PATTERN.test(value)) return setErrors({ handle: t("competitors.invalidHandle") });
    // Quick duplicate check against what's on screen; the server checks again.
    const tracked = queryClient.getQueryData<CompetitorDto[]>(qk.competitors) ?? [];
    if (tracked.some((c) => c.handle === value && c.id !== competitor?.id)) {
      return setErrors({ handle: t("competitors.form.alreadyTracked", { handle: value }) });
    }
    setErrors({});
    save.mutate({ handle: value, displayName: displayName.trim() || null, note: note.trim() || null });
  }

  const busy = save.isPending;
  return (
    <form onSubmit={submit} noValidate className="space-y-4 p-4">
      <div className="space-y-1.5">
        <Label htmlFor="competitor-handle">{t("competitors.form.handle")}</Label>
        <div className="relative">
          <span className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-body text-muted" aria-hidden="true">
            @
          </span>
          <Input
            id="competitor-handle"
            value={handle}
            onChange={(e) => {
              setHandle(e.target.value);
              if (errors.handle) setErrors((x) => ({ ...x, handle: undefined }));
            }}
            placeholder="competitor.handle"
            className={cn("ps-7", errors.handle && "border-danger focus:border-danger")}
            dir="ltr"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={Boolean(errors.handle) || undefined}
            aria-describedby="competitor-handle-help"
            disabled={busy}
            autoFocus={!editing}
          />
        </div>
        <p id="competitor-handle-help" className={cn("text-caption", errors.handle ? "text-danger" : "text-muted")} role={errors.handle ? "alert" : undefined}>
          {errors.handle ?? (editing ? t("competitors.form.handleEditHint") : t("competitors.form.handleHint"))}
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="competitor-name">
          {t("competitors.form.displayName")} <span className="font-normal text-muted">· {t("competitors.form.optional")}</span>
        </Label>
        <Input
          id="competitor-name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder={competitor?.name ?? t("competitors.form.displayNamePlaceholder")}
          maxLength={60}
          dir="auto"
          disabled={busy}
          autoFocus={editing}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="competitor-note">
          {t("competitors.form.note")} <span className="font-normal text-muted">· {t("competitors.form.optional")}</span>
        </Label>
        <Input
          id="competitor-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("competitors.form.notePlaceholder")}
          maxLength={80}
          dir="auto"
          disabled={busy}
        />
      </div>

      {errors.form && (
        <p role="alert" className="rounded-card bg-secondary-bg px-3 py-2.5 text-body text-danger">
          {errors.form}{" "}
          {errors.needsInstagram && (
            <Link href="/settings#instagram" className="font-semibold text-primary hover:underline">
              {t("instagramPrompt.connect")}
            </Link>
          )}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="secondary" onClick={onDone} disabled={busy}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={busy || !handle.trim()}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          {busy
            ? editing
              ? t("common.saving")
              : t("competitors.form.adding")
            : editing
              ? t("common.save")
              : t("competitors.form.submit")}
        </Button>
      </div>
    </form>
  );
}
