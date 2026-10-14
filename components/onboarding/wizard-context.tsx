"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { OnboardingStepId } from "@/config/onboarding";
import { apiFetch, type ApiClientError } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/queries";
import { useI18n } from "@/lib/i18n/provider";
import { notify } from "@/store/ui-store";
import type { OnboardingStateDto } from "@/types";

type Direction = "forward" | "back" | "jump";

interface WizardValue {
  state: OnboardingStateDto;
  /** Saves the move on the server (resume point + events) and shows the new step. */
  go: (step: OnboardingStepId, direction: Direction, details?: Record<string, unknown>) => Promise<void>;
  moving: boolean;
  /** Puts a fresh server state into the cache (after a save that returns it). */
  setState: (state: OnboardingStateDto) => void;
}

const WizardContext = createContext<WizardValue | null>(null);

/** Server reasons a forward move was refused (lib/server/onboarding.ts → blockerFor). */
const BLOCKERS = new Set(["business_name_missing", "instagram_required", "out_of_order"]);

export function WizardProvider({ state, children }: { state: OnboardingStateDto; children: ReactNode }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const setState = (next: OnboardingStateDto) => queryClient.setQueryData(qk.onboarding, next);

  const move = useMutation<OnboardingStateDto, ApiClientError, { step: OnboardingStepId; direction: Direction; details?: Record<string, unknown> }>({
    meta: { handlesErrors: true },
    mutationFn: (body) => apiFetch("/api/onboarding/progress", { method: "POST", body }),
    onSuccess: (next) => {
      setState(next);
      window.scrollTo({ top: 0 });
    },
    onError: (error) => {
      const reason = Array.isArray(error.details) ? (error.details as Array<{ path?: string; message?: string }>).find((d) => d.path === "step")?.message : undefined;
      notify.error(reason && BLOCKERS.has(reason) ? t(`onboarding.blockers.${reason}`) : errorMessage(error, t));
      // The server may know more (e.g. a step finished in another tab).
      queryClient.invalidateQueries({ queryKey: qk.onboarding });
    },
  });

  const value: WizardValue = {
    state,
    go: async (step, direction, details) => {
      await move.mutateAsync({ step, direction, details }).catch(() => undefined);
    },
    moving: move.isPending,
    setState,
  };
  return <WizardContext.Provider value={value}>{children}</WizardContext.Provider>;
}

export function useWizard() {
  const ctx = useContext(WizardContext);
  if (!ctx) throw new Error("useWizard must be used inside <WizardProvider>");
  return ctx;
}
