"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiFetch, type ApiClientError } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/provider";
import { notify } from "@/store/ui-store";
import type { OnboardingStateDto } from "@/types";
import { StepFrame } from "../step-frame";
import { TargetsFeelingsFields, type TargetsFeelingsValue } from "../targets-feelings-fields";
import { useWizard } from "../wizard-context";

/**
 * Step 3 — Your goals: two quick chip questions. What they want more of (sales, followers, visits,
 * messages — several, each with an optional number) and how their posts should feel (several, plus
 * their own word under "Other"). Nothing is required.
 */
export function StepGoals() {
  const { t } = useI18n();
  const { state, go, skip, moving, setState } = useWizard();
  const b = state.business;
  const [form, setForm] = useState<TargetsFeelingsValue>({ targets: b.targets, feelings: b.feelings, feelingOther: b.feelingOther });

  const save = useMutation<OnboardingStateDto, ApiClientError, TargetsFeelingsValue>({
    meta: { handlesErrors: true },
    mutationFn: (body) => apiFetch("/api/onboarding/goals", { method: "PUT", body: { ...body, feelingOther: body.feelingOther?.trim() || null } }),
    onSuccess: async (next) => {
      setState(next);
      await go("location", "forward");
    },
    onError: (e) => notify.error(errorMessage(e, t)),
  });

  return (
    <StepFrame
      step="goals"
      title={t("onboarding.steps.goals.title")}
      helper={t("onboarding.steps.goals.helper")}
      onBack={() => go("style", "back")}
      onSkip={() => skip("goals")}
      primary={{ label: t("onboarding.continue"), onClick: () => save.mutate(form), busy: moving || save.isPending }}
      reportContext={{ targets: form.targets.map((x) => x.key), feelings: form.feelings, other: form.feelingOther !== null }}
    >
      <TargetsFeelingsFields value={form} onChange={setForm} />
    </StepFrame>
  );
}
