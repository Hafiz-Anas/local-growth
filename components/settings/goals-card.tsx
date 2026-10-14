"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ErrorState, Skeleton } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DEFAULT_AIM, DEFAULT_GOALS, DEFAULT_TIMELINE, type BusinessAim, type BusinessGoal, type GoalTimeline } from "@/config/onboarding";
import { apiFetch } from "@/lib/api/client";
import { qk, useAction, useGoals, type GoalsDto } from "@/lib/api/queries";
import { useI18n } from "@/lib/i18n/provider";
import { notify } from "@/store/ui-store";
import { GoalsFields, type GoalsValue } from "./goals-fields";

/** Settings → Goals: niche, aim, goals and timeline (set in onboarding; the AI works towards them). */
export function GoalsCard() {
  const { t } = useI18n();
  const goals = useGoals();
  return (
    <Card>
      <CardHeader className="pb-0">
        <CardTitle>{t("goals.title")}</CardTitle>
        <p className="text-caption text-muted">{t("goals.settingsHint")}</p>
      </CardHeader>
      <CardContent className="pt-4">
        {goals.isPending ? (
          <Skeleton className="h-48" />
        ) : goals.isError ? (
          <ErrorState error={goals.error} onRetry={() => goals.refetch()} />
        ) : (
          <GoalsForm key={JSON.stringify(goals.data)} initial={goals.data} />
        )}
      </CardContent>
    </Card>
  );
}

function GoalsForm({ initial }: { initial: GoalsDto }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [niche, setNiche] = useState(initial.niche ?? "");
  const [value, setValue] = useState<GoalsValue>({
    aim: (initial.aim as BusinessAim | null) ?? DEFAULT_AIM,
    goals: (initial.goals.length ? initial.goals : DEFAULT_GOALS) as BusinessGoal[],
    timeline: (initial.timeline as GoalTimeline | null) ?? DEFAULT_TIMELINE,
  });
  const save = useAction({
    mutationFn: () => apiFetch<GoalsDto>("/api/brand/goals", { method: "PUT", body: { ...value, niche: niche.trim() || null } }),
    onSuccess: (data) => {
      queryClient.setQueryData(qk.goals, data);
      notify.success(t("goals.saved"));
    },
  });
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div>
        <label htmlFor="goals-niche" className="mb-1.5 block text-body font-semibold">
          {t("onboarding.brand.niche")}
        </label>
        <Input id="goals-niche" value={niche} onChange={(e) => setNiche(e.target.value)} maxLength={80} placeholder={t("onboarding.brand.nichePlaceholder")} dir="auto" />
      </div>
      <GoalsFields value={value} onChange={setValue} />
      <Button type="submit" disabled={save.isPending || value.goals.length === 0}>
        {t("common.save")}
      </Button>
    </form>
  );
}
