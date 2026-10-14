"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AtSign, Check, CircleAlert, CircleCheck, Loader2, Plus, X } from "lucide-react";
import { HANDLE_PATTERN, normalizeHandle } from "@/components/competitors/helpers";
import { Avatar } from "@/components/shared/avatar";
import { EmptyState } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MAX_ONBOARDING_COMPETITORS } from "@/config/onboarding";
import { reportOnboardingEvent } from "@/lib/api/brand";
import { apiFetch, type ApiClientError } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/queries";
import { useI18n } from "@/lib/i18n/provider";
import { cn, formatCompact, initials, toneFor } from "@/lib/utils";
import { notify } from "@/store/ui-store";
import type { CompetitorValidation, OnboardingCompetitorDto, OnboardingStateDto } from "@/types";
import { StepFrame } from "../step-frame";
import { useWizard } from "../wizard-context";

const BADGE: Record<CompetitorValidation, "success" | "warning" | "danger"> = {
  ready: "success",
  not_business: "warning",
  private: "warning",
  not_found: "danger",
  own_account: "danger",
};

/**
 * Step 4 — Competitors, optional: add a few accounts now or later (Competitor Insights). Both
 * "Finish" and "Add later" complete onboarding; nothing in the app needs competitors.
 */
export function StepCompetitors() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { state, go, moving } = useWizard();
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const competitors = state.competitors;
  const ready = competitors.filter((c) => c.status === "ready").length;

  const finish = useMutation<{ status: "completed" }, ApiClientError, { skipped: boolean }>({
    meta: { handlesErrors: true },
    mutationFn: () => apiFetch("/api/onboarding/complete", { method: "POST" }),
    onError: (e) => {
      const reason = Array.isArray(e.details) ? (e.details as Array<{ message?: string }>)[0]?.message : undefined;
      if (reason !== "instagram_required") return notify.error(errorMessage(e, t));
      // An admin now requires Instagram: back to step 1.
      notify.error(t("onboarding.blockers.instagram_required"));
      void go("instagram", "jump");
    },
    onSuccess: () => {
      // The (user) layout now lets them in.
      router.replace("/dashboard?welcome=1");
      router.refresh();
    },
  });
  const updateList = (update: (list: OnboardingCompetitorDto[]) => OnboardingCompetitorDto[]) =>
    queryClient.setQueryData<OnboardingStateDto>(qk.onboarding, (s) => s && { ...s, competitors: update(s.competitors) });

  const add = useMutation<OnboardingCompetitorDto, ApiClientError, { handle: string; displayName: string | null }>({
    meta: { handlesErrors: true },
    mutationFn: (body) => apiFetch("/api/onboarding/competitors", { method: "POST", body }),
    onSuccess: (competitor) => {
      updateList((list) => [...list, competitor]);
      setHandle("");
      setDisplayName("");
      setError(null);
    },
    onError: (e) => {
      const reason = Array.isArray(e.details) ? (e.details as Array<{ message?: string }>)[0]?.message : undefined;
      setError(reason === "already_tracked" ? t("onboarding.competitors.duplicate") : reason === "limit_reached" ? t("onboarding.competitors.limit", { max: MAX_ONBOARDING_COMPETITORS }) : errorMessage(e, t));
    },
  });

  const remove = useMutation<{ id: string }, ApiClientError, string, { previous?: OnboardingCompetitorDto[] }>({
    mutationFn: (id) => apiFetch(`/api/onboarding/competitors/${id}`, { method: "DELETE" }),
    onMutate: (id) => {
      const previous = queryClient.getQueryData<OnboardingStateDto>(qk.onboarding)?.competitors;
      updateList((list) => list.filter((c) => c.id !== id));
      return { previous };
    },
    onError: (_e, _id, context) => context?.previous && updateList(() => context.previous!),
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const value = normalizeHandle(handle);
    if (!HANDLE_PATTERN.test(value)) {
      setError(t("competitors.invalidHandle"));
      reportOnboardingEvent("competitors", "error", { kind: "invalid_handle" });
      return;
    }
    if (competitors.some((c) => c.handle === value)) return setError(t("onboarding.competitors.duplicate"));
    add.mutate({ handle: value, displayName: displayName.trim() || null });
  }

  return (
    <StepFrame
      step="competitors"
      title={t("onboarding.steps.competitors.title")}
      helper={t("onboarding.steps.competitors.helper")}
      onBack={() => go("goals", "back")}
      primary={{ label: t("onboarding.finish"), onClick: () => finish.mutate({ skipped: false }), busy: moving || finish.isPending, icon: <Check className="size-4" /> }}
      secondary={
        competitors.length === 0 && (
          <Button variant="ghost" size="md" onClick={() => finish.mutate({ skipped: true })} disabled={finish.isPending}>
            {t("onboarding.competitors.addLater")}
          </Button>
        )
      }
      reportContext={{ ready, listed: competitors.length, statuses: competitors.map((c) => c.status) }}
    >
      <form onSubmit={submit} className="rounded-panel border border-border p-4">
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <div className="relative">
            <AtSign className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
            <Input
              value={handle}
              onChange={(e) => {
                setHandle(e.target.value);
                setError(null);
              }}
              placeholder="competitor.handle"
              aria-label={t("competitors.form.handle")}
              dir="ltr"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={Boolean(error) || undefined}
              className={cn("ps-9", error && "border-danger")}
            />
          </div>
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={60} placeholder={t("onboarding.competitors.displayName")} aria-label={t("onboarding.competitors.displayName")} />
          <Button type="submit" size="md" disabled={!handle.trim() || add.isPending || competitors.length >= MAX_ONBOARDING_COMPETITORS}>
            {add.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            {add.isPending ? t("onboarding.competitors.checking") : t("common.add")}
          </Button>
        </div>
        {error ? (
          <p role="alert" className="mt-2 text-caption text-danger">
            {error}
          </p>
        ) : (
          <p className="mt-2 text-caption text-muted">{t("onboarding.competitors.tip")}</p>
        )}
      </form>

      {ready > 0 && <p className="mt-6 mb-2 text-body font-semibold">{t("onboarding.competitors.tracked", { count: ready })}</p>}

      {competitors.length === 0 ? (
        <EmptyState icon={AtSign} title={t("onboarding.competitors.emptyTitle")} hint={t("onboarding.competitors.emptyHint")} className="mt-6 rounded-panel border border-dashed border-border py-8" />
      ) : (
        <ul className="divide-y divide-separator rounded-panel border border-border" aria-live="polite">
          {competitors.map((c) => (
            <li key={c.id} className="flex items-start gap-3 px-4 py-3">
              <Avatar src={c.avatarUrl} initials={initials(c.displayName ?? c.handle)} tone={toneFor(c.handle)} size="md" ring={c.status === "ready" ? "story" : "none"} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="truncate text-body font-semibold" dir="ltr">
                    @{c.handle}
                  </span>
                  <Badge variant={BADGE[c.status]} size="sm">
                    {c.status === "ready" ? <CircleCheck aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}
                    {t(`onboarding.competitors.status.${c.status}`)}
                  </Badge>
                </div>
                <p className="truncate text-caption text-muted">
                  {c.status === "ready"
                    ? [c.displayName ?? c.name, c.followers ? t("onboarding.competitors.followers", { count: formatCompact(c.followers, locale) }) : null].filter(Boolean).join(" · ")
                    : null}
                </p>
                {c.status !== "ready" && <p className="mt-0.5 text-caption text-foreground">{t(`onboarding.competitors.reasons.${c.status}`)}</p>}
              </div>
              <Button variant="ghost" size="icon-sm" onClick={() => remove.mutate(c.id)} aria-label={t("onboarding.competitors.remove", { handle: c.handle })}>
                <X className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </StepFrame>
  );
}
