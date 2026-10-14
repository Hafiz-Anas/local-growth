"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { GoalsFields } from "@/components/settings/goals-fields";
import { DEFAULT_AIM, DEFAULT_GOALS, DEFAULT_TIMELINE, type BusinessAim, type BusinessGoal, type GoalTimeline } from "@/config/onboarding";
import { apiFetch, type ApiClientError } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/provider";
import { notify } from "@/store/ui-store";
import type { OnboardingStateDto } from "@/types";
import { StepFrame } from "../step-frame";
import { useWizard } from "../wizard-context";

/** Step 3 — Goals: aim, goals and timeline as taps, all pre-selected, so "Continue" is enough. Editable later in Settings. */
export function StepGoals() {
  const { t } = useI18n();
  const { state, go, moving, setState } = useWizard();
  const b = state.business;
  const [value, setValue] = useState({
    aim: (b.aim as BusinessAim | null) ?? DEFAULT_AIM,
    goals: (b.goals.length ? b.goals : DEFAULT_GOALS) as BusinessGoal[],
    timeline: (b.timeline as GoalTimeline | null) ?? DEFAULT_TIMELINE,
  });

  const save = useMutation<OnboardingStateDto, ApiClientError, typeof value>({
    meta: { handlesErrors: true },
    mutationFn: (body) => apiFetch("/api/onboarding/goals", { method: "PUT", body }),
    onSuccess: async (next) => {
      setState(next);
      await go("competitors", "forward");
    },
    onError: (e) => notify.error(errorMessage(e, t)),
  });

  return (
    <StepFrame
      step="goals"
      title={t("onboarding.steps.goals.title")}
      helper={t("onboarding.steps.goals.helper")}
      onBack={() => go("brand", "back")}
      primary={{ label: t("onboarding.continue"), onClick: () => save.mutate(value), disabled: value.goals.length === 0, busy: moving || save.isPending }}
      blockedNote={value.goals.length === 0 ? t("goals.pickOne") : null}
      reportContext={value}
    >
      <GoalsFields value={value} onChange={setValue} />
    </StepFrame>
  );
}
