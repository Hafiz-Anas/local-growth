"use client";

import { startTransition, useEffect, useRef, type ReactNode } from "react";
import { LogOut } from "lucide-react";
import { LogoMark, Wordmark } from "@/components/brand/logo";
import { LanguageToggle, ThemeToggle } from "@/components/layout/toggles";
import { ErrorState, Skeleton } from "@/components/shared/states";
import { VerifyEmailBanner } from "@/components/shared/verify-email-banner";
import { Button } from "@/components/ui/button";
import { PROGRESS_STEPS, stepNumber, type OnboardingStepId } from "@/config/onboarding";
import { beaconOnboardingEvent, reportOnboardingEvent, useOnboardingState } from "@/lib/api/brand";
import { logoutAction } from "@/lib/auth/actions";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { StepBrand } from "./steps/step-brand";
import { StepBusiness } from "./steps/step-business";
import { StepCompetitors } from "./steps/step-competitors";
import { StepInstagram } from "./steps/step-instagram";
import { StepPosts } from "./steps/step-posts";
import { StepResult } from "./steps/step-result";
import { StepReview } from "./steps/step-review";
import { WizardProvider } from "./wizard-context";

/**
 * Self-onboarding wizard: full screen, no sidebar. The server keeps the
 * current step, so leaving and logging in again resumes in the same place.
 * Step openings and page closes are reported for the admin Onboarding page.
 */
export function OnboardingWizard({ userName }: { userName: string }) {
  const { t } = useI18n();
  const query = useOnboardingState();
  const step = query.data?.step ?? null;

  // One "started" per step visit, and "abandoned" if the page closes mid-step.
  const current = useRef<OnboardingStepId | null>(null);
  useEffect(() => {
    if (!step) return;
    current.current = step;
    reportOnboardingEvent(step, "started");
  }, [step]);
  useEffect(() => {
    const onHide = () => {
      if (current.current) beaconOnboardingEvent(current.current, "abandoned", { reason: "page_closed" });
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);

  const logout = () => {
    if (current.current) beaconOnboardingEvent(current.current, "abandoned", { reason: "logged_out" });
    current.current = null;
    startTransition(() => logoutAction());
  };

  return (
    <div className="flex min-h-dvh flex-col">
      {query.data && !query.data.emailVerified && <VerifyEmailBanner email={query.data.email} />}
      <header className="sticky top-0 z-20 border-b border-border bg-background">
        <div className="mx-auto flex h-14 w-full max-w-[680px] items-center gap-2 px-4">
          <span className="inline-flex items-center gap-2">
            <LogoMark className="size-7" />
            <Wordmark className="hidden text-[18px] sm:inline" />
          </span>
          <span className="ms-auto" />
          <ThemeToggle />
          <LanguageToggle compact />
          <Button variant="ghost" size="sm" onClick={logout} title={t("onboarding.logoutHint", { name: userName })}>
            <LogOut className="size-4 rtl:-scale-x-100" />
            <span className="hidden sm:inline">{t("topbar.logout")}</span>
          </Button>
        </div>
        <Progress step={step} />
      </header>

      {query.isPending ? (
        <WizardSkeleton />
      ) : query.isError ? (
        <main className="mx-auto w-full max-w-[680px] px-4 py-10">
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        </main>
      ) : (
        <WizardProvider state={query.data}>
          <StepRouter step={query.data.step} />
        </WizardProvider>
      )}
    </div>
  );
}

function StepRouter({ step }: { step: OnboardingStepId }): ReactNode {
  // Each step keeps its own form state; keyed so returning to a step starts from the saved values.
  switch (step) {
    case "business":
      return <StepBusiness key={step} />;
    case "instagram":
      return <StepInstagram key={step} />;
    case "competitors":
      return <StepCompetitors key={step} />;
    case "posts":
      return <StepPosts key={step} />;
    case "brand":
      return <StepBrand key={step} />;
    case "review":
      return <StepReview key={step} />;
    case "result":
      return <StepResult key={step} />;
  }
}

/** Instagram-stories style segments, one per step, plus "Step 1 of 6 · Connect Instagram". */
function Progress({ step }: { step: OnboardingStepId | null }) {
  const { t } = useI18n();
  const n = step ? Math.min(stepNumber(step), PROGRESS_STEPS.length) : 0;
  const done = step === "result";
  return (
    <div className="mx-auto w-full max-w-[680px] px-4 pb-3">
      <div className="flex gap-1" role="progressbar" aria-valuemin={1} aria-valuemax={PROGRESS_STEPS.length} aria-valuenow={n} aria-label={t("onboarding.progressLabel")}>
        {PROGRESS_STEPS.map((id, i) => (
          <span
            key={id}
            className={cn("h-[3px] flex-1 rounded-pill transition-colors", i < n - 1 || done ? "bg-foreground" : i === n - 1 ? "bg-ig-gradient" : "bg-border")}
          />
        ))}
      </div>
      {step && (
        <p className="mt-2 text-caption text-muted">
          {done ? t("onboarding.almostDone") : t("onboarding.stepOf", { n, total: PROGRESS_STEPS.length, name: t(`onboarding.steps.${step}.short`) })}
        </p>
      )}
    </div>
  );
}

function WizardSkeleton() {
  return (
    <main aria-busy="true" className="mx-auto w-full max-w-[680px] px-4 pt-10">
      <Skeleton className="h-7 w-64" />
      <Skeleton className="mt-3 h-4 w-96 max-w-full" />
      <div className="mt-8 space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    </main>
  );
}
