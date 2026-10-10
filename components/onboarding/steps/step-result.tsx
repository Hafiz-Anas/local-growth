"use client";

import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, RefreshCw } from "lucide-react";
import { BrandContextView } from "@/components/brand/brand-context-view";
import { EmptyState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { apiFetch, type ApiClientError } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/queries";
import { useI18n } from "@/lib/i18n/provider";
import { notify } from "@/store/ui-store";
import type { BrandContextDto, BrandContextPatch, OnboardingStateDto } from "@/types";
import { StepFrame } from "../step-frame";
import { useWizard } from "../wizard-context";

/** "Here's what we learned about your brand" — edit anything, then confirm to finish onboarding. */
export function StepResult() {
  const { t } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { state, go, moving } = useWizard();
  const context = state.brandContext;
  const setContext = (next: BrandContextDto) => queryClient.setQueryData<OnboardingStateDto>(qk.onboarding, (s) => s && { ...s, brandContext: next });

  const edit = useMutation<BrandContextDto, ApiClientError, BrandContextPatch>({
    mutationFn: (patch) => apiFetch("/api/brand/context", { method: "PATCH", body: patch }),
    onSuccess: (next) => {
      setContext(next);
      notify.success(t("brand.context.saved"));
    },
  });
  const rebuild = useMutation<BrandContextDto, ApiClientError>({
    meta: { handlesErrors: true },
    mutationFn: () => apiFetch("/api/brand/context", { method: "POST" }),
    onSuccess: (next) => {
      setContext(next);
      notify.success(t("brand.profile.rebuilt", { version: next.version }));
    },
    onError: (e) => notify.error(e.code === "ai_error" ? t("onboarding.review.failedBody") : errorMessage(e, t)),
  });
  const finish = useMutation<{ status: "completed" }, ApiClientError>({
    meta: { handlesErrors: true },
    mutationFn: () => apiFetch("/api/onboarding/complete", { method: "POST" }),
    onError: (e) => {
      const reason = Array.isArray(e.details) ? (e.details as Array<{ message?: string }>)[0]?.message : undefined;
      if (reason !== "instagram_required") return notify.error(errorMessage(e, t));
      // An admin now requires Instagram: send them back to step 1.
      notify.error(t("onboarding.blockers.instagram_required"));
      void go("instagram", "jump");
    },
    onSuccess: () => {
      // The (user) layout now lets them in; /onboarding redirects to the dashboard from here on.
      router.replace("/dashboard?welcome=1");
      router.refresh();
    },
  });

  return (
    <StepFrame
      step="result"
      title={t("onboarding.steps.result.title")}
      helper={t("onboarding.steps.result.helper")}
      onBack={() => go("review", "back")}
      primary={{ label: t("onboarding.result.confirm"), onClick: () => finish.mutate(), disabled: !context, busy: finish.isPending || finish.isSuccess || moving, icon: <Check className="size-4" /> }}
      secondary={
        <Button variant="ghost" size="md" onClick={() => rebuild.mutate()} disabled={rebuild.isPending || finish.isPending}>
          {rebuild.isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          <span className="hidden sm:inline">{t("brand.profile.rebuild")}</span>
        </Button>
      }
      reportContext={{ version: context?.version ?? null, edited: context?.editedByUser ?? false }}
    >
      {context ? (
        <div className={rebuild.isPending ? "pointer-events-none opacity-50" : undefined}>
          <BrandContextView context={context} onSave={(patch) => edit.mutateAsync(patch)} />
        </div>
      ) : (
        <EmptyState icon={RefreshCw} title={t("onboarding.result.missingTitle")} hint={t("onboarding.result.missingHint")} />
      )}
    </StepFrame>
  );
}
