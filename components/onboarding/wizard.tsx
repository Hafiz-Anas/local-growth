"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CircleCheck, Clock, LogOut } from "lucide-react";
import Link from "next/link";
import { LogoMark, Wordmark } from "@/components/brand/logo";
import type { CurrentAccount } from "@/components/layout/account-switcher";
import { ActiveAccountSwitcher } from "@/components/layout/login-switcher";
import { LanguageToggle, ThemeToggle } from "@/components/layout/toggles";
import { ErrorState, Skeleton } from "@/components/shared/states";
import { VerifyEmailBanner } from "@/components/shared/verify-email-banner";
import { Button } from "@/components/ui/button";
import { PROGRESS_STEPS, stepNumber, type OnboardingStepId } from "@/config/onboarding";
import { beaconOnboardingEvent, reportOnboardingEvent, useOnboardingState } from "@/lib/api/brand";
import { logOutOf } from "@/lib/api/device-accounts";
import { apiFetch } from "@/lib/api/client";
import { qk } from "@/lib/api/queries";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { StyleGuideDto } from "@/types";
import { StyleSummaryField } from "./style-summary";
import { StepBusiness } from "./steps/step-business";
import { StepCompetitors } from "./steps/step-competitors";
import { StepGoals } from "./steps/step-goals";
import { StepLocation } from "./steps/step-location";
import { StepStyle } from "./steps/step-style";
import { WizardProvider } from "./wizard-context";

/**
 * Self-onboarding wizard: full screen, no sidebar, five light steps (Instagram was connected at
 * sign-up). Every step has Skip, and "Finish later" is in the header. The server keeps the current
 * step and every step saves on Continue, so leaving resumes in the same place. Finishing shows a
 * short "You're all set" screen that leads Home. Step openings and page closes are reported for the
 * admin Onboarding page.
 */
export function OnboardingWizard({
  userName,
  verificationUnsent = false,
  showVerifyBanner = false,
  account,
}: {
  userName: string;
  /** Set when the login has other Instagram accounts: the switcher replaces the logo, so an added account's setup can be left for another account. */
  account?: CurrentAccount;
  verificationUnsent?: boolean;
  /** EMAIL_VERIFICATION_BANNER (lib/server/email-verification.ts). */
  showVerifyBanner?: boolean;
}) {
  const { t } = useI18n();
  const query = useOnboardingState();
  // After "Finish" the wizard shows "You're all set" (onboarding is complete on the server by then).
  const [finished, setFinished] = useState<{ style: StyleGuideDto | null } | null>(null);
  const step = finished ? null : (query.data?.step ?? null);

  // One "started" per step visit, and "abandoned" if the page closes mid-step.
  const current = useRef<OnboardingStepId | null>(null);
  useEffect(() => {
    if (!step) {
      current.current = null;
      return;
    }
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

  const router = useRouter();
  const [deferring, setDeferring] = useState(false);
  const finishLater = async () => {
    setDeferring(true);
    current.current = null;
    try {
      await apiFetch("/api/onboarding/defer", { method: "POST" });
      router.push("/dashboard");
      router.refresh();
    } catch {
      setDeferring(false);
    }
  };

  const logout = () => {
    if (current.current) beaconOnboardingEvent(current.current, "abandoned", { reason: "logged_out" });
    current.current = null;
    void logOutOf(false);
  };

  return (
    <div className="flex min-h-dvh flex-col">
      {showVerifyBanner && query.data && <VerifyEmailBanner unverified={!query.data.emailVerified} email={query.data.email} sendFailed={verificationUnsent} />}
      <header className="sticky top-0 z-20 border-b border-border bg-background">
        <div className="mx-auto flex h-14 w-full max-w-[680px] items-center gap-2 px-4">
          {account ? (
            <ActiveAccountSwitcher current={account} compact />
          ) : (
            <span className="inline-flex items-center gap-2">
              <LogoMark className="size-7" />
              <Wordmark className="hidden text-[18px] sm:inline" />
            </span>
          )}
          <span className="ms-auto" />
          {step && (
            <Button variant="ghost" size="sm" onClick={finishLater} disabled={deferring}>
              <Clock className="size-4" aria-hidden="true" />
              {t("onboarding.finishLater")}
            </Button>
          )}
          <ThemeToggle />
          <LanguageToggle compact />
          <Button variant="ghost" size="sm" onClick={logout} title={t("onboarding.logoutHint", { name: userName })}>
            <LogOut className="size-4 rtl:-scale-x-100" />
            <span className="hidden sm:inline">{t("topbar.logout")}</span>
          </Button>
        </div>
        {!finished && <Progress step={step} />}
      </header>

      {finished ? (
        <AllSet style={finished.style} />
      ) : query.isPending ? (
        <WizardSkeleton />
      ) : query.isError ? (
        <main className="mx-auto w-full max-w-[680px] px-4 py-10">
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        </main>
      ) : (
        <WizardProvider state={query.data} onFinished={() => setFinished({ style: query.data.style })}>
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
    case "style":
      return <StepStyle key={step} />;
    case "goals":
      return <StepGoals key={step} />;
    case "location":
      return <StepLocation key={step} />;
    case "competitors":
      return <StepCompetitors key={step} />;
  }
}

/** Rough minutes left from each step (about two minutes in all). */
const MINUTES_LEFT = { business: 2, style: 2, goals: 1, location: 1, competitors: 1 } as const satisfies Record<OnboardingStepId, number>;

/** Instagram-stories style segments, one per step, plus "Step 1 of 5 · Your business · about 2 min left". */
function Progress({ step }: { step: OnboardingStepId | null }) {
  const { t } = useI18n();
  const n = step ? Math.min(stepNumber(step), PROGRESS_STEPS.length) : 0;
  return (
    <div className="mx-auto w-full max-w-[680px] px-4 pb-3">
      <div className="flex gap-1" role="progressbar" aria-valuemin={1} aria-valuemax={PROGRESS_STEPS.length} aria-valuenow={n} aria-label={t("onboarding.progressLabel")}>
        {PROGRESS_STEPS.map((id, i) => (
          <span
            key={id}
            title={t(`onboarding.steps.${id}.short`)}
            className={cn("h-[3px] flex-1 rounded-pill transition-colors", i < n - 1 ? "bg-foreground" : i === n - 1 ? "bg-ig-gradient" : "bg-border")}
          />
        ))}
      </div>
      {step && (
        <p className="mt-2 text-caption text-muted" data-testid="wizard-step">
          {t("onboarding.stepOf", { n, total: PROGRESS_STEPS.length, name: t(`onboarding.steps.${step}.short`) })} · {t("onboarding.minutesLeft", { minutes: MINUTES_LEFT[step] })}
        </p>
      )}
    </div>
  );
}

/**
 * "You're all set": a short wrap-up that leads Home, with the photo style line (editable) when the
 * owner picked photos — it fills in when the background analysis is done.
 */
function AllSet({ style }: { style: StyleGuideDto | null }) {
  const { t } = useI18n();
  const router = useRouter();
  const guide = useQuery<StyleGuideDto | null>({
    queryKey: qk.styleGuide,
    queryFn: () => apiFetch("/api/brand/style"),
    initialData: style,
    enabled: style !== null,
    refetchInterval: (q) => (q.state.data?.status === "building" && q.state.dataUpdateCount < 20 ? 3000 : false),
  });
  // The (user) layout reads the finished onboarding from the server.
  useEffect(() => router.prefetch("/dashboard"), [router]);
  return (
    <main className="mx-auto flex w-full max-w-[480px] flex-1 flex-col items-center px-4 pt-14 pb-12 text-center" data-testid="all-set">
      <span className="flex size-16 items-center justify-center rounded-pill bg-ig-gradient text-white">
        <CircleCheck className="size-8" strokeWidth={1.75} aria-hidden="true" />
      </span>
      <h1 className="mt-5 text-heading font-bold">{t("onboarding.allSet.title")}</h1>
      <p className="mt-1.5 text-body text-muted">{t("onboarding.allSet.body")}</p>
      {guide.data && (
        <div className="mt-6 w-full text-start">
          <StyleSummaryField guide={guide.data} />
        </div>
      )}
      <ul className="mt-6 w-full space-y-2 text-start text-body">
        {(["captions", "replies", "settings"] as const).map((key) => (
          <li key={key} className="flex items-start gap-2">
            <CircleCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            {t(`onboarding.allSet.points.${key}`)}
          </li>
        ))}
      </ul>
      <Button asChild size="lg" className="mt-8 w-full">
        <Link href="/dashboard" onClick={() => router.refresh()}>
          {t("onboarding.allSet.home")}
          <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden="true" />
        </Link>
      </Button>
    </main>
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
