"use client";

import { Slider } from "@/components/ui/slider";
import { useI18n } from "@/lib/i18n/provider";

/** 0 = formal Arabic … 100 = casual Kuwaiti, with a live example line. Shared by Settings and onboarding. */
export function ToneSlider({
  value,
  onChange,
  onCommit,
  disabled,
}: {
  value: number;
  onChange: (value: number) => void;
  onCommit?: (value: number) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const example = value < 34 ? t("settings.voice.exampleFormal") : value < 67 ? t("settings.voice.exampleBalanced") : t("settings.voice.exampleCasual");
  return (
    <div>
      <Slider
        value={[value]}
        onValueChange={([v]) => onChange(v)}
        onValueCommit={([v]) => onCommit?.(v)}
        max={100}
        step={1}
        disabled={disabled}
        aria-label={t("settings.voice.tone")}
      />
      <div className="mt-2 flex justify-between text-caption text-muted">
        <span>{t("settings.voice.formal")}</span>
        <span>{t("settings.voice.casual")}</span>
      </div>
      <div className="mt-3 rounded-card bg-secondary-bg px-3 py-2.5">
        <p className="text-caption text-muted">{t("settings.voice.example")}</p>
        <p className="mt-0.5 text-body" dir="rtl">
          {example}
        </p>
      </div>
    </div>
  );
}

/** Short label for a tone value ("Formal", "Balanced", "Casual"). */
export function toneLabelKey(value: number) {
  return value < 34 ? "brand.tone.formal" : value < 67 ? "brand.tone.balanced" : "brand.tone.casual";
}
