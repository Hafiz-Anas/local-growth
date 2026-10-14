"use client";

import { Check } from "lucide-react";
import { ChipSelect } from "@/components/shared/chip-select";
import { BUSINESS_AIMS, BUSINESS_GOALS, GOAL_TIMELINES, type BusinessAim, type BusinessGoal, type GoalTimeline } from "@/config/onboarding";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

export interface GoalsValue {
  aim: BusinessAim;
  goals: BusinessGoal[];
  timeline: GoalTimeline;
}

/** Aim (one), goals (several) and timeline (one) as chips — onboarding, Settings → Goals and the one-time prompt. */
export function GoalsFields({ value, onChange, size = "md" }: { value: GoalsValue; onChange: (value: GoalsValue) => void; size?: "sm" | "md" }) {
  const { t } = useI18n();
  const toggle = (goal: BusinessGoal) =>
    onChange({ ...value, goals: value.goals.includes(goal) ? value.goals.filter((g) => g !== goal) : [...value.goals, goal] });

  return (
    <div className="space-y-5">
      <ChipSelect size={size} label={t("goals.aim")} value={value.aim} onChange={(aim) => onChange({ ...value, aim })} options={BUSINESS_AIMS.map((a) => ({ value: a, label: t(`goals.aims.${a}`) }))} />

      <fieldset>
        <legend className="mb-1 text-body font-semibold">{t("goals.goals")}</legend>
        <p className="mb-2.5 text-caption text-muted">{t("goals.goalsHint")}</p>
        <div className="flex flex-wrap gap-2">
          {BUSINESS_GOALS.map((goal) => {
            const on = value.goals.includes(goal);
            return (
              <button
                key={goal}
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => toggle(goal)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-button px-3 font-semibold transition-colors [&_svg]:size-4",
                  size === "sm" ? "h-7 text-caption" : "h-8 text-body",
                  on ? "bg-foreground text-background" : "bg-button-secondary text-foreground hover:bg-button-secondary-hover",
                )}
              >
                {on && <Check aria-hidden="true" />}
                {t(`goals.goalOptions.${goal}`)}
              </button>
            );
          })}
        </div>
      </fieldset>

      <ChipSelect
        size={size}
        label={t("goals.timeline")}
        value={value.timeline}
        onChange={(timeline) => onChange({ ...value, timeline })}
        options={GOAL_TIMELINES.map((tl) => ({ value: tl, label: t(`goals.timelines.${tl}`) }))}
      />
    </div>
  );
}
