"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { ColorPalette } from "@/components/brand/color-palette";
import { LogoCard } from "@/components/brand/logo-card";
import { ToneSlider } from "@/components/brand/tone-slider";
import { Skeleton } from "@/components/shared/states";
import { TagInput } from "@/components/shared/tag-input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useColorSuggestions } from "@/lib/api/brand";
import { apiFetch, type ApiClientError } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/provider";
import { notify } from "@/store/ui-store";
import type { BrandBasicsDto } from "@/types";
import { StepFrame } from "../step-frame";
import { useWizard } from "../wizard-context";

/** Step 5 — Brand basics: colours (suggested from the posts), logo, tone, words to use and avoid. */
export function StepBrand() {
  const { t } = useI18n();
  const { state, go, moving } = useWizard();
  const saved = state.brand;
  // null = still following the suggestions from the posts.
  const [colors, setColors] = useState<string[] | null>(saved.colors.length ? saved.colors : null);
  const [tone, setTone] = useState(saved.toneLevel);
  const [wordsToUse, setWordsToUse] = useState(saved.wordsToUse);
  const [wordsToAvoid, setWordsToAvoid] = useState(saved.wordsToAvoid);
  const suggestions = useColorSuggestions();
  const shownColors = colors ?? suggestions.data?.colors ?? [];

  const save = useMutation<BrandBasicsDto, ApiClientError>({
    meta: { handlesErrors: true },
    mutationFn: () => apiFetch("/api/brand/basics", { method: "PUT", body: { colors: shownColors, toneLevel: tone, wordsToUse, wordsToAvoid } }),
    onSuccess: () => go("review", "forward"),
    onError: (e) => notify.error(errorMessage(e, t)),
  });

  return (
    <StepFrame
      step="brand"
      title={t("onboarding.steps.brand.title")}
      helper={t("onboarding.steps.brand.helper")}
      onBack={() => go("posts", "back")}
      primary={{ label: t("onboarding.continue"), onClick: () => save.mutate(), busy: save.isPending || moving }}
      reportContext={{ colors: shownColors.length, suggested: suggestions.data?.colors.length ?? null, hasLogo: Boolean(saved.logoUrl) }}
    >
      <div className="space-y-4">
        <Card className="p-4">
          <div className="mb-1 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-title font-bold">{t("brand.basics.colors")}</h2>
              <p className="text-caption text-muted">
                {colors === null ? t("onboarding.brand.colorsSuggested") : t("onboarding.brand.colorsEdited")}
              </p>
            </div>
            {colors !== null && (suggestions.data?.colors.length ?? 0) > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setColors(null)}>
                <RotateCcw className="size-4" />
                {t("onboarding.brand.useSuggestions")}
              </Button>
            )}
          </div>
          <div className="mt-3">
            {colors === null && suggestions.isPending ? (
              <div className="flex gap-2.5" aria-label={t("onboarding.brand.extracting")}>
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="size-11 rounded-pill" />
                ))}
              </div>
            ) : (
              <ColorPalette colors={shownColors} onChange={setColors} />
            )}
            {colors === null && suggestions.isSuccess && suggestions.data.colors.length === 0 && (
              <p className="mt-2 text-caption text-muted">{t("onboarding.brand.noSuggestions")}</p>
            )}
          </div>
        </Card>

        <LogoCard logoUrl={saved.logoUrl} />

        <Card className="p-4">
          <h2 className="mb-3 text-title font-bold">{t("settings.voice.tone")}</h2>
          <ToneSlider value={tone} onChange={setTone} />
        </Card>

        <Card className="space-y-5 p-4">
          <div>
            <h2 className="text-title font-bold">
              {t("brand.basics.wordsToUse")} <span className="text-caption font-normal text-muted">· {t("common.optional")}</span>
            </h2>
            <p className="mb-3 text-caption text-muted">{t("onboarding.brand.wordsToUseHint")}</p>
            <TagInput values={wordsToUse} onChange={setWordsToUse} placeholder={t("onboarding.brand.wordPlaceholder")} addLabel={t("common.add")} />
          </div>
          <div>
            <h2 className="text-title font-bold">
              {t("brand.basics.wordsToAvoid")} <span className="text-caption font-normal text-muted">· {t("common.optional")}</span>
            </h2>
            <p className="mb-3 text-caption text-muted">{t("onboarding.brand.wordsToAvoidHint")}</p>
            <TagInput values={wordsToAvoid} onChange={setWordsToAvoid} placeholder={t("onboarding.brand.avoidPlaceholder")} addLabel={t("common.add")} />
          </div>
        </Card>
      </div>
    </StepFrame>
  );
}
