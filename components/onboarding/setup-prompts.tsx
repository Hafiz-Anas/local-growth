"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Sparkles, Target, X } from "lucide-react";
import { useActiveClient } from "@/components/providers/active-client-provider";
import { GoalsFields, type GoalsValue } from "@/components/settings/goals-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DEFAULT_AIM, DEFAULT_GOALS, DEFAULT_TIMELINE } from "@/config/onboarding";
import { apiFetch } from "@/lib/api/client";
import { useAction } from "@/lib/api/queries";
import { useI18n } from "@/lib/i18n/provider";

/**
 * Set-up prompts at the top of Settings (they were on the old Home; the Gallery stays as designed): "Finish setting up" after "Finish
 * later" in onboarding, a one-time card for businesses that finished the older wizard to complete the
 * new steps (style, goals, location…; started or skipped, it doesn't come back), and a one-time card for
 * existing businesses to set their niche and goals (saved or dismissed, it doesn't come back; Settings →
 * Goals always has it).
 */
export function SetupPrompts() {
  const { client, isPreview } = useActiveClient();
  if (isPreview || !client.setup) return null;
  if (client.setup.onboardingStepsLeft !== null) return <FinishSetup stepsLeft={client.setup.onboardingStepsLeft} />;
  if (client.setup.newStepsPromptDue) return <NewStepsPrompt />;
  if (client.setup.goalsPromptDue) return <GoalsPrompt />;
  return null;
}

function FinishSetup({ stepsLeft }: { stepsLeft: number }) {
  const { t } = useI18n();
  return (
    <section className="mb-8 flex flex-wrap items-center gap-3 rounded-panel border border-border p-4" data-testid="finish-setup">
      <div className="min-w-0 flex-1">
        <p className="text-body font-semibold">{t("setup.finishTitle")}</p>
        <p className="text-caption text-muted">{t("setup.finishBody", { count: stepsLeft })}</p>
      </div>
      <Button asChild>
        <Link href="/onboarding">
          {t("setup.finishAction")}
          <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden="true" />
        </Link>
      </Button>
    </section>
  );
}

function NewStepsPrompt() {
  const { t } = useI18n();
  const router = useRouter();
  const start = useAction({
    mutationFn: () => apiFetch("/api/onboarding/new-steps", { method: "POST" }),
    onSuccess: () => {
      router.push("/onboarding");
      router.refresh();
    },
  });
  const skip = useAction({
    mutationFn: () => apiFetch("/api/onboarding/new-steps", { method: "DELETE" }),
    onSuccess: () => router.refresh(),
  });
  const busy = start.isPending || skip.isPending;
  return (
    <section className="mb-8 rounded-panel border border-border p-4" aria-labelledby="new-steps-title" data-testid="new-steps-prompt">
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 id="new-steps-title" className="text-title font-bold">
            {t("setup.newStepsTitle")}
          </h2>
          <p className="text-caption text-muted">{t("setup.newStepsBody")}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => start.mutate()} disabled={busy}>
          {t("setup.newStepsAction")}
          <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden="true" />
        </Button>
        <Button variant="ghost" onClick={() => skip.mutate()} disabled={busy}>
          {t("onboarding.skip")}
        </Button>
      </div>
    </section>
  );
}

function GoalsPrompt() {
  const { t } = useI18n();
  const router = useRouter();
  const [niche, setNiche] = useState("");
  const [value, setValue] = useState<GoalsValue>({ aim: DEFAULT_AIM, goals: DEFAULT_GOALS, timeline: DEFAULT_TIMELINE });
  const save = useAction({
    mutationFn: () => apiFetch("/api/brand/goals", { method: "PUT", body: { ...value, niche: niche.trim() || null } }),
    onSuccess: () => router.refresh(),
  });
  const dismiss = useAction({
    mutationFn: () => apiFetch("/api/brand/goals/prompt", { method: "DELETE" }),
    onSuccess: () => router.refresh(),
  });
  return (
    <section className="mb-8 rounded-panel border border-border p-4" aria-labelledby="goals-prompt-title" data-testid="goals-prompt">
      <div className="mb-3 flex items-start gap-2">
        <Target className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 id="goals-prompt-title" className="text-title font-bold">
            {t("setup.goalsTitle")}
          </h2>
          <p className="text-caption text-muted">{t("setup.goalsBody")}</p>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={() => dismiss.mutate()} aria-label={t("setup.notNow")} disabled={dismiss.isPending}>
          <X aria-hidden="true" />
        </Button>
      </div>
      <div className="space-y-4">
        <div>
          <label htmlFor="prompt-niche" className="mb-1.5 block text-body font-semibold">
            {t("onboarding.brand.niche")}
          </label>
          <Input id="prompt-niche" value={niche} onChange={(e) => setNiche(e.target.value)} maxLength={80} placeholder={t("onboarding.brand.nichePlaceholder")} dir="auto" />
        </div>
        <GoalsFields value={value} onChange={setValue} size="sm" />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => save.mutate()} disabled={save.isPending || value.goals.length === 0}>
          {t("common.save")}
        </Button>
        <Button variant="ghost" onClick={() => dismiss.mutate()} disabled={dismiss.isPending}>
          {t("setup.notNow")}
        </Button>
      </div>
    </section>
  );
}
