"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiFetch, type ApiClientError } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/provider";
import { notify } from "@/store/ui-store";
import type { OnboardingStateDto } from "@/types";
import { LocationFields, type LocationValue } from "../location-fields";
import { StepFrame } from "../step-frame";
import { useWizard } from "../wizard-context";

/** Step 4 — Your location: governorate and area in Kuwait, and delivery only / shop / both. */
export function StepLocation() {
  const { t } = useI18n();
  const { state, go, skip, moving, setState } = useWizard();
  const b = state.business;
  const [value, setValue] = useState<LocationValue>({ governorate: b.governorate, area: b.area, serviceMode: b.serviceMode });

  const save = useMutation<OnboardingStateDto, ApiClientError, LocationValue>({
    meta: { handlesErrors: true },
    mutationFn: (body) => apiFetch("/api/onboarding/location", { method: "PUT", body }),
    onSuccess: async (next) => {
      setState(next);
      await go("competitors", "forward");
    },
    onError: (e) => notify.error(errorMessage(e, t)),
  });

  return (
    <StepFrame
      step="location"
      title={t("onboarding.steps.location.title")}
      helper={t("onboarding.steps.location.helper")}
      onBack={() => go("goals", "back")}
      onSkip={() => skip("location")}
      primary={{ label: t("onboarding.continue"), onClick: () => save.mutate(value), busy: moving || save.isPending }}
      reportContext={{ ...value }}
    >
      <LocationFields value={value} onChange={setValue} />
    </StepFrame>
  );
}
