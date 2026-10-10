"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { EventStepId } from "@/config/onboarding";
import type { BrandProfileDto, OnboardingStateDto, PickableMediaDto } from "@/types";
import { apiFetch, type ApiClientError } from "./client";
import { qk } from "./queries";

/**
 * Hooks shared by the onboarding wizard and Settings → Brand profile. They use
 * plain queries/mutations (the wizard has no ActiveClientProvider); screens
 * that can be previewed pass `readOnly` to the brand components instead.
 */

export const useOnboardingState = () =>
  useQuery<OnboardingStateDto, ApiClientError>({ queryKey: qk.onboarding, queryFn: () => apiFetch("/api/onboarding") });

/** Recent posts of the connected account, for the brand-post picker. */
export const useInstagramMedia = (enabled: boolean) =>
  useQuery<PickableMediaDto[], ApiClientError>({ queryKey: qk.instagramMedia, queryFn: () => apiFetch("/api/instagram/media"), enabled, staleTime: 60_000 });

export const useColorSuggestions = (enabled = true) =>
  useQuery<{ colors: string[]; fromImages: number }, ApiClientError>({
    queryKey: qk.brandColors,
    queryFn: () => apiFetch("/api/brand/colors"),
    enabled,
    staleTime: 30_000,
  });

/** After any brand change: both the wizard state and the settings profile reload. */
export function useRefreshBrand() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.onboarding }),
      queryClient.invalidateQueries({ queryKey: qk.brand }),
      queryClient.invalidateQueries({ queryKey: qk.generatorOptions }),
      queryClient.invalidateQueries({ queryKey: qk.brandVoice }),
    ]);
}

export function useBrandProfileCache() {
  const queryClient = useQueryClient();
  return (update: (profile: BrandProfileDto) => BrandProfileDto) =>
    queryClient.setQueryData<BrandProfileDto>(qk.brand, (profile) => profile && update(profile));
}

/** Reports something only the browser saw (a rejected file, a form error) to the onboarding trail. Best effort. */
export function reportOnboardingEvent(step: EventStepId, event: "started" | "error" | "abandoned", details?: Record<string, unknown>) {
  apiFetch("/api/onboarding/events", { method: "POST", body: { step, event, details } }).catch(() => {
    // Instrumentation must never get in the user's way.
  });
}

/** Same, but survives the page closing (navigator.sendBeacon). */
export function beaconOnboardingEvent(step: EventStepId, event: "abandoned", details?: Record<string, unknown>) {
  const body = JSON.stringify({ step, event, details });
  if (typeof navigator !== "undefined" && navigator.sendBeacon) navigator.sendBeacon("/api/onboarding/events", new Blob([body], { type: "application/json" }));
}
