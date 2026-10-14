"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Sparkles } from "lucide-react";
import { ChipSelect } from "@/components/shared/chip-select";
import { TagInput } from "@/components/shared/tag-input";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BUSINESS_TYPES, FEW_POSTS, TONE_PRESETS, tonePresetOf, type BusinessType, type TonePreset } from "@/config/onboarding";
import { apiFetch, type ApiClientError } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/provider";
import { notify } from "@/store/ui-store";
import type { OnboardingStateDto } from "@/types";
import { StepFrame } from "../step-frame";
import { useWizard } from "../wizard-context";

interface BrandForm {
  businessName: string;
  businessType: BusinessType | null;
  niche: string;
  toneLevel: number;
  hashtags: string[];
  products: string[];
  exampleCaption: string;
}

const hashtag = (v: string) => (v ? `#${v.replace(/^#+/, "").replace(/\s+/g, "")}` : "");

/**
 * Step 2 — Confirm your brand. The AI reads the Instagram bio and recent posts and fills in the
 * niche, type, tone and hashtags; the owner just checks them. The fields are usable while it
 * works, and if the AI is unavailable they simply stay empty. New accounts with few posts get
 * an optional "add an example caption". Only the business name is required.
 */
export function StepBrand() {
  const { t, locale } = useI18n();
  const { state, go, moving, setState } = useWizard();
  const prefill = state.prefill;
  const [edits, setEdits] = useState<Partial<BrandForm>>({});

  // Ask once for the suggestions; the step works without them.
  const prefillRun = useMutation<OnboardingStateDto, ApiClientError>({
    meta: { handlesErrors: true },
    mutationFn: () => apiFetch("/api/onboarding/prefill", { method: "POST", body: { locale } }),
    onSuccess: setState,
  });
  const asked = useRef(false);
  useEffect(() => {
    if (prefill || asked.current) return;
    asked.current = true;
    prefillRun.mutate();
  }, [prefill, prefillRun]);
  const filling = !prefill && !prefillRun.isError;

  // Saved values win (coming back to this step), then the suggestions, then the owner's edits on top.
  const saved = state.business;
  const confirmedBefore = saved.niche !== null || state.hashtags.length > 0;
  const form: BrandForm = {
    businessName: saved.name,
    businessType: saved.businessType ?? prefill?.businessType ?? null,
    niche: saved.niche ?? prefill?.niche ?? "",
    toneLevel: confirmedBefore ? state.brand.toneLevel : (prefill?.toneLevel ?? state.brand.toneLevel),
    hashtags: state.hashtags.length ? state.hashtags : (prefill?.hashtags ?? []),
    products: saved.products.length ? saved.products : (prefill?.products ?? []),
    exampleCaption: saved.exampleCaption ?? "",
    ...edits,
  };
  const set = <K extends keyof BrandForm>(key: K, value: BrandForm[K]) => setEdits((e) => ({ ...e, [key]: value }));
  const fewPosts = state.instagram.status === "disconnected" || (prefill !== null && prefill.postsWithCaptions < FEW_POSTS);

  const save = useMutation<OnboardingStateDto, ApiClientError, BrandForm>({
    meta: { handlesErrors: true },
    mutationFn: (body) =>
      apiFetch("/api/onboarding/brand", {
        method: "PUT",
        body: { ...body, niche: body.niche.trim() || null, exampleCaption: body.exampleCaption.trim() || null },
      }),
    onSuccess: async (next) => {
      setState(next);
      await go("goals", "forward");
    },
    onError: (e) => notify.error(errorMessage(e, t)),
  });

  const tones = (Object.keys(TONE_PRESETS) as TonePreset[]).map((key) => ({ value: key, label: t(`onboarding.brand.tones.${key}`) }));

  return (
    <StepFrame
      step="brand"
      title={t("onboarding.steps.brand.title")}
      helper={prefill?.aiUsed ? t("onboarding.steps.brand.helper") : t("onboarding.steps.brand.helperManual")}
      onBack={() => go("instagram", "back")}
      primary={{ label: t("onboarding.continue"), onClick: () => save.mutate(form), disabled: !form.businessName.trim(), busy: moving || save.isPending }}
      blockedNote={!form.businessName.trim() ? t("onboarding.brand.nameNeeded") : null}
      reportContext={{ prefilled: Boolean(prefill), aiUsed: prefill?.aiUsed ?? null, posts: prefill?.postsWithCaptions ?? null }}
    >
      <p className="mb-5 flex items-center gap-2 rounded-card bg-hover px-3 py-2 text-caption" role="status" data-testid="prefill-status">
        {filling ? <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" /> : <Sparkles className="size-4 shrink-0" aria-hidden="true" />}
        {filling ? t("onboarding.brand.filling") : prefill?.aiUsed ? t("onboarding.brand.filled") : t("onboarding.brand.notFilled")}
      </p>

      <div className="space-y-5">
        <div>
          <label htmlFor="ob-name" className="mb-1.5 block text-body font-semibold">
            {t("onboarding.brand.name")}
          </label>
          <Input id="ob-name" value={form.businessName} onChange={(e) => set("businessName", e.target.value)} maxLength={120} />
        </div>

        <div>
          <label htmlFor="ob-niche" className="mb-1.5 block text-body font-semibold">
            {t("onboarding.brand.niche")}
          </label>
          <Input id="ob-niche" value={form.niche} onChange={(e) => set("niche", e.target.value)} maxLength={80} placeholder={t("onboarding.brand.nichePlaceholder")} dir="auto" />
        </div>

        <ChipSelect
          size="sm"
          label={t("onboarding.brand.type")}
          value={form.businessType}
          onChange={(v) => set("businessType", v)}
          options={BUSINESS_TYPES.map((type) => ({ value: type, label: t(`businessTypes.${type}`) }))}
        />

        <ChipSelect size="sm" label={t("onboarding.brand.tone")} hint={t("onboarding.brand.toneHint")} value={tonePresetOf(form.toneLevel)} onChange={(v) => set("toneLevel", TONE_PRESETS[v])} options={tones} />

        <div>
          <p className="mb-1 text-body font-semibold">{t("onboarding.brand.hashtags")}</p>
          <p className="mb-2 text-caption text-muted">{t("onboarding.brand.hashtagsHint")}</p>
          <TagInput values={form.hashtags} onChange={(v) => set("hashtags", v)} placeholder="#yourbrand" addLabel={t("common.add")} normalize={hashtag} />
        </div>

        {fewPosts && (
          <section className="rounded-panel border border-dashed border-border p-4" data-testid="few-posts-fallback">
            <p className="text-body font-semibold">{t("onboarding.brand.fallbackTitle")}</p>
            <p className="mb-3 text-caption text-muted">{t("onboarding.brand.fallbackHint")}</p>
            <Textarea
              value={form.exampleCaption}
              onChange={(e) => set("exampleCaption", e.target.value)}
              maxLength={2200}
              rows={3}
              dir="auto"
              aria-label={t("onboarding.brand.exampleCaption")}
              placeholder={t("onboarding.brand.exampleCaptionPlaceholder")}
            />
          </section>
        )}

        <details className="rounded-panel border border-border p-4">
          <summary className="cursor-pointer text-body font-semibold">{t("onboarding.brand.more")}</summary>
          <div className="mt-3">
            <p className="mb-2 text-caption text-muted">{t("onboarding.brand.productsHint")}</p>
            <TagInput values={form.products} onChange={(v) => set("products", v)} placeholder={t("onboarding.brand.productsPlaceholder")} addLabel={t("common.add")} />
          </div>
        </details>
      </div>
    </StepFrame>
  );
}
