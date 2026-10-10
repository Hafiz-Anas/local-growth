"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Pencil, Sparkles } from "lucide-react";
import { BrandPostGrid } from "@/components/brand/brand-post-grid";
import { ColorPalette } from "@/components/brand/color-palette";
import { toneLabelKey } from "@/components/brand/tone-slider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { OnboardingStepId } from "@/config/onboarding";
import { apiFetch, type ApiClientError } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/queries";
import { useI18n } from "@/lib/i18n/provider";
import type { BrandContextDto } from "@/types";
import { StepFrame } from "../step-frame";
import { useWizard } from "../wizard-context";

/** Step 6 — Review & build: everything entered, with Edit links, then "Build my brand profile". */
export function StepReview() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { state, go, moving } = useWizard();
  const { business, instagram, competitors, posts, brand } = state;
  const ready = competitors.filter((c) => c.status === "ready");

  const build = useMutation<BrandContextDto, ApiClientError>({
    meta: { handlesErrors: true },
    mutationFn: () => apiFetch("/api/brand/context", { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.onboarding }),
  });

  if (build.isPending || (build.isSuccess && state.step === "review")) return <Building />;

  const edit = (step: OnboardingStepId) => () => go(step, "jump", { from: "review" });
  const type = business.businessType === "other" ? business.businessTypeOther : business.businessType ? t(`businessTypes.${business.businessType}`) : "—";

  return (
    <StepFrame
      step="review"
      title={t("onboarding.steps.review.title")}
      helper={t("onboarding.steps.review.helper")}
      onBack={() => go("brand", "back")}
      primary={{ label: t("onboarding.review.build"), onClick: () => build.mutate(), busy: moving, icon: <Sparkles className="size-4" /> }}
      reportContext={{ ready: ready.length, posts: posts.length, buildError: build.error?.code ?? null }}
    >
      {build.isError && (
        <div role="alert" className="mb-4 flex items-start gap-3 rounded-panel border border-danger/40 bg-danger/5 p-4">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-body font-semibold">{t("onboarding.review.failedTitle")}</p>
            <p className="text-caption text-muted">{build.error.code === "ai_error" ? t("onboarding.review.failedBody") : errorMessage(build.error, t)}</p>
          </div>
          <Button variant="secondary" onClick={() => build.mutate()}>
            {t("states.retry")}
          </Button>
        </div>
      )}

      <div className="space-y-3">
        <ReviewCard title={t("onboarding.steps.instagram.short")} onEdit={edit("instagram")} disabled={moving}>
          {instagram.status === "disconnected" ? (
            <p className="text-body text-muted">{t("onboarding.review.instagramSkipped")}</p>
          ) : (
            <p className="text-body" dir="ltr">
              @{instagram.username ?? instagram.handle}
            </p>
          )}
        </ReviewCard>

        <ReviewCard title={t("onboarding.steps.business.short")} onEdit={edit("business")} disabled={moving}>
          <dl className="grid gap-x-4 gap-y-2 text-body sm:grid-cols-[140px_1fr]">
            <Row label={t("onboarding.business.type")} value={type ?? "—"} />
            <Row label={t("onboarding.business.location")} value={business.location || "—"} />
            <Row label={t("onboarding.business.description")} value={business.description || "—"} />
            <Row label={t("onboarding.business.products")} value={business.products.join("، ") || "—"} />
            {business.targetAudience && <Row label={t("onboarding.business.audience")} value={business.targetAudience} />}
          </dl>
        </ReviewCard>

        <ReviewCard title={t("onboarding.steps.competitors.short")} onEdit={edit("competitors")} disabled={moving}>
          <ul className="flex flex-wrap gap-1.5">
            {ready.map((c) => (
              <li key={c.id}>
                <Badge variant="neutral" dir="ltr">
                  @{c.handle}
                </Badge>
              </li>
            ))}
          </ul>
        </ReviewCard>

        <ReviewCard title={t("onboarding.steps.posts.short")} onEdit={edit("posts")} disabled={moving}>
          {posts.length > 0 ? <BrandPostGrid posts={posts} className="max-w-[420px]" /> : <p className="text-body text-muted">{t("onboarding.review.postsSkipped")}</p>}
        </ReviewCard>

        <ReviewCard title={t("onboarding.steps.brand.short")} onEdit={edit("brand")} disabled={moving}>
          <div className="space-y-3">
            {brand.colors.length > 0 ? <ColorPalette colors={brand.colors} readOnly size="sm" /> : <p className="text-body text-muted">{t("onboarding.review.noColors")}</p>}
            <dl className="grid gap-x-4 gap-y-2 text-body sm:grid-cols-[140px_1fr]">
              <Row label={t("brand.basics.logo")} value={brand.logoUrl ? t("onboarding.review.logoAdded") : t("onboarding.review.noLogo")} />
              <Row label={t("settings.voice.tone")} value={t(toneLabelKey(brand.toneLevel))} />
              <Row label={t("brand.basics.wordsToUse")} value={brand.wordsToUse.join("، ") || "—"} />
              <Row label={t("brand.basics.wordsToAvoid")} value={brand.wordsToAvoid.join("، ") || "—"} />
            </dl>
          </div>
        </ReviewCard>
      </div>
    </StepFrame>
  );
}

function ReviewCard({ title, onEdit, disabled, children }: { title: string; onEdit: () => void; disabled?: boolean; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <Card>
      <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2">
        <h2 className="text-body font-bold">{title}</h2>
        <Button variant="link" size="sm" onClick={onEdit} disabled={disabled} aria-label={t("onboarding.review.editSection", { section: title })}>
          <Pencil className="size-3.5" />
          {t("common.edit")}
        </Button>
      </div>
      <div className="px-4 pb-4">{children}</div>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-caption text-muted sm:text-body">{label}</dt>
      <dd className="break-words" dir="auto">
        {value}
      </dd>
    </>
  );
}

const BUILD_LINES = ["reading", "colors", "captions", "purposes"] as const;

/** While the AI builds the profile: the gradient mark and a line that changes every few seconds. */
function Building() {
  const { t } = useI18n();
  const [line, setLine] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setLine((l) => (l + 1) % BUILD_LINES.length), 1400);
    return () => clearInterval(id);
  }, []);
  return (
    <main className="mx-auto flex w-full max-w-[680px] flex-1 flex-col items-center justify-center px-4 py-16 text-center" aria-busy="true">
      <span className="mb-6 flex size-20 animate-pulse items-center justify-center rounded-pill bg-ig-gradient text-white">
        <Sparkles className="size-9" strokeWidth={1.5} aria-hidden="true" />
      </span>
      <h1 className="text-heading font-bold">{t("onboarding.review.buildingTitle")}</h1>
      <p className="mt-2 text-body text-muted" aria-live="polite">
        {t(`onboarding.review.building.${BUILD_LINES[line]}`)}
      </p>
    </main>
  );
}
