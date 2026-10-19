"use client";

import type { ReactNode } from "react";
import { ChevronLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { OnboardingStepId } from "@/config/onboarding";
import { useI18n } from "@/lib/i18n/provider";
import { ReportProblem } from "./report-problem";

/**
 * One wizard step: title, short helper, the step's content, "Report a
 * problem", and a footer pinned to the bottom with Back / Skip / Continue
 * (every step can be skipped; "Finish later" is in the header). When
 * Continue is disabled, `blockedNote` says why.
 */
export function StepFrame({
  step,
  title,
  helper,
  children,
  onBack,
  onSkip,
  primary,
  secondary,
  blockedNote,
  reportContext,
}: {
  step: OnboardingStepId;
  title: string;
  helper?: ReactNode;
  children: ReactNode;
  onBack?: () => void;
  /** "Skip": move on without saving this step. */
  onSkip?: () => void;
  primary: { label: string; onClick: () => void; disabled?: boolean; busy?: boolean; icon?: ReactNode };
  /** Extra action next to Continue, e.g. "Skip for now". */
  secondary?: ReactNode;
  blockedNote?: string | null;
  /** Step state summary attached to "Report a problem". */
  reportContext?: Record<string, unknown>;
}) {
  const { t } = useI18n();
  return (
    <>
      <main className="mx-auto w-full max-w-[680px] flex-1 px-4 pt-6 pb-10 sm:pt-10">
        <h1 className="text-heading font-bold">{title}</h1>
        {helper && <div className="mt-1.5 text-body text-muted">{helper}</div>}
        <div className="mt-6">{children}</div>
        <div className="mt-10 flex justify-center">
          <ReportProblem step={step} context={reportContext} />
        </div>
      </main>

      <footer className="sticky bottom-0 z-10 border-t border-border bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-[680px] items-center gap-3 px-4 py-3">
          {onBack ? (
            <Button variant="secondary" size="md" onClick={onBack} disabled={primary.busy}>
              <ChevronLeft className="size-4 rtl:-scale-x-100" />
              {t("onboarding.back")}
            </Button>
          ) : (
            <span />
          )}
          <p className="hidden min-w-0 flex-1 truncate text-end text-caption text-muted sm:block" aria-live="polite">
            {primary.disabled && blockedNote}
          </p>
          <div className="ms-auto flex items-center gap-2 sm:ms-0">
            {secondary}
            {onSkip && (
              <Button variant="ghost" size="md" onClick={onSkip} disabled={primary.busy} data-testid="skip-step">
                {t("onboarding.skip")}
              </Button>
            )}
            <Button size="md" onClick={primary.onClick} disabled={primary.disabled || primary.busy} aria-busy={primary.busy}>
              {primary.busy ? <Loader2 className="size-4 animate-spin" /> : primary.icon}
              {primary.label}
            </Button>
          </div>
        </div>
        {primary.disabled && blockedNote && <p className="px-4 pb-3 text-center text-caption text-muted sm:hidden">{blockedNote}</p>}
      </footer>
    </>
  );
}
