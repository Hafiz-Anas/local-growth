"use client";

import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { FEELINGS, MAX_TARGET_NUMBER, TARGETS, type Feeling, type Target, type TargetKey } from "@/config/onboarding";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

export interface TargetsFeelingsValue {
  targets: Target[];
  feelings: Feeling[];
  /** null = "Other" not picked. */
  feelingOther: string | null;
}

/**
 * What they want more of (sales, followers, visits, messages — several, each with an optional
 * number) and how their posts should feel (several, plus their own word under "Other"). Onboarding's
 * "Your goals" and Settings → Goals.
 */
export function TargetsFeelingsFields({ value, onChange, disabled = false }: { value: TargetsFeelingsValue; onChange: (value: TargetsFeelingsValue) => void; disabled?: boolean }) {
  const { t } = useI18n();
  const set = (patch: Partial<TargetsFeelingsValue>) => !disabled && onChange({ ...value, ...patch });
  const hasTarget = (key: TargetKey) => value.targets.some((x) => x.key === key);
  const toggleTarget = (key: TargetKey) => set({ targets: hasTarget(key) ? value.targets.filter((x) => x.key !== key) : [...value.targets, { key, number: null }] });
  const setNumber = (key: TargetKey, raw: string) => {
    const n = Number.parseInt(raw.replace(/\D/g, ""), 10);
    set({ targets: value.targets.map((x) => (x.key === key ? { ...x, number: Number.isFinite(n) && n > 0 ? Math.min(n, MAX_TARGET_NUMBER) : null } : x)) });
  };
  const toggleFeeling = (feeling: Feeling) => set({ feelings: value.feelings.includes(feeling) ? value.feelings.filter((x) => x !== feeling) : [...value.feelings, feeling] });

  return (
    <div className="space-y-8">
      <fieldset disabled={disabled}>
        <legend className="mb-1 text-body font-semibold">{t("onboarding.goals.targets")}</legend>
        <p className="mb-2.5 text-caption text-muted">{t("onboarding.goals.targetsHint")}</p>
        <div className="flex flex-wrap gap-2">
          {TARGETS.map((key) => (
            <Chip key={key} on={hasTarget(key)} onClick={() => toggleTarget(key)}>
              {t(`onboarding.goals.targetOptions.${key}`)}
            </Chip>
          ))}
        </div>
        {value.targets.length > 0 && (
          <ul className="mt-4 space-y-2">
            {value.targets.map((target) => (
              <li key={target.key} className="flex items-center gap-3">
                <label htmlFor={`target-${target.key}`} className="min-w-0 flex-1 text-caption">
                  {t("onboarding.goals.numberLabel", { target: t(`onboarding.goals.targetOptions.${target.key}`) })}
                </label>
                <Input
                  id={`target-${target.key}`}
                  inputMode="numeric"
                  value={target.number ?? ""}
                  onChange={(e) => setNumber(target.key, e.target.value)}
                  placeholder={t("onboarding.goals.numberPlaceholder")}
                  className="w-28"
                  dir="ltr"
                />
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <fieldset disabled={disabled}>
        <legend className="mb-1 text-body font-semibold">{t("onboarding.goals.feeling")}</legend>
        <p className="mb-2.5 text-caption text-muted">{t("onboarding.goals.feelingHint")}</p>
        <div className="flex flex-wrap gap-2">
          {FEELINGS.map((feeling) => (
            <Chip key={feeling} on={value.feelings.includes(feeling)} onClick={() => toggleFeeling(feeling)}>
              {t(`onboarding.goals.feelings.${feeling}`)}
            </Chip>
          ))}
          <Chip on={value.feelingOther !== null} onClick={() => set({ feelingOther: value.feelingOther === null ? "" : null })}>
            {t("onboarding.goals.other")}
          </Chip>
        </div>
        {value.feelingOther !== null && (
          <Input
            value={value.feelingOther}
            onChange={(e) => set({ feelingOther: e.target.value })}
            maxLength={60}
            placeholder={t("onboarding.goals.otherPlaceholder")}
            aria-label={t("onboarding.goals.otherLabel")}
            className="mt-3"
            dir="auto"
          />
        )}
      </fieldset>
    </div>
  );
}

/** A multi-select chip (checkbox semantics), like the goals chips in Settings. */
function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-button px-3 text-body font-semibold transition-colors disabled:opacity-50 [&_svg]:size-4",
        on ? "bg-foreground text-background" : "bg-button-secondary text-foreground hover:bg-button-secondary-hover",
      )}
    >
      {on && <Check aria-hidden="true" />}
      {children}
    </button>
  );
}
