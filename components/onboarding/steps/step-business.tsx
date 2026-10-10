"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ChipSelect } from "@/components/shared/chip-select";
import { TagInput } from "@/components/shared/tag-input";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BUSINESS_TYPES, type BusinessType } from "@/config/onboarding";
import { reportOnboardingEvent } from "@/lib/api/brand";
import { apiFetch, type ApiClientError } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { businessProfileSchema } from "@/lib/validation/api";
import { notify } from "@/store/ui-store";
import type { OnboardingStateDto } from "@/types";
import { StepFrame } from "../step-frame";
import { useWizard } from "../wizard-context";

type Field = "businessType" | "businessTypeOther" | "location" | "description" | "products" | "targetAudience";

/**
 * Step 2 — Your business: type, location, what they sell, products, audience.
 * The posting language isn't asked; it is learned from the captions when the
 * brand profile is built (and can be changed in Settings → Brand profile).
 */
export function StepBusiness() {
  const { t } = useI18n();
  const { state, go, moving, setState } = useWizard();
  const saved = state.business;
  const [businessType, setBusinessType] = useState<BusinessType | null>(saved.businessType);
  const [businessTypeOther, setBusinessTypeOther] = useState(saved.businessTypeOther ?? "");
  const [location, setLocation] = useState(saved.location);
  const [description, setDescription] = useState(saved.description ?? "");
  const [products, setProducts] = useState(saved.products);
  const [targetAudience, setTargetAudience] = useState(saved.targetAudience ?? "");
  const [errors, setErrors] = useState<Set<Field>>(new Set());

  const input = {
    businessType,
    businessTypeOther: businessTypeOther.trim() || null,
    location: location.trim(),
    description: description.trim(),
    products,
    targetAudience: targetAudience.trim() || null,
  };

  const save = useMutation<OnboardingStateDto, ApiClientError>({
    meta: { handlesErrors: true },
    mutationFn: () => apiFetch("/api/onboarding/business", { method: "PUT", body: input }),
    onSuccess: async (next) => {
      setState(next);
      await go("competitors", "forward");
    },
    onError: (error) => notify.error(errorMessage(error, t)),
  });

  function submit() {
    const parsed = businessProfileSchema.safeParse(input);
    if (!parsed.success) {
      const fields = new Set(parsed.error.issues.map((i) => i.path[0] as Field));
      setErrors(fields);
      reportOnboardingEvent("business", "error", { kind: "validation", fields: [...fields] });
      return;
    }
    setErrors(new Set());
    save.mutate();
  }

  const bad = (field: Field) => errors.has(field);
  const clear = (field: Field) => errors.has(field) && setErrors((e) => new Set([...e].filter((f) => f !== field)));

  return (
    <StepFrame
      step="business"
      title={t("onboarding.steps.business.title")}
      helper={t("onboarding.steps.business.helper")}
      onBack={() => go("instagram", "back")}
      primary={{ label: t("onboarding.continue"), onClick: submit, busy: save.isPending || moving }}
      reportContext={{ filled: Object.entries(input).filter(([, v]) => (Array.isArray(v) ? v.length : v)).map(([k]) => k) }}
    >
      <div className="space-y-7">
        <div>
          <ChipSelect<BusinessType>
            label={t("onboarding.business.type")}
            value={businessType}
            onChange={(v) => {
              setBusinessType(v);
              clear("businessType");
            }}
            invalid={bad("businessType")}
            options={BUSINESS_TYPES.map((type) => ({ value: type, label: t(`businessTypes.${type}`) }))}
          />
          {businessType === "other" && (
            <Input
              value={businessTypeOther}
              onChange={(e) => {
                setBusinessTypeOther(e.target.value);
                clear("businessTypeOther");
              }}
              maxLength={60}
              placeholder={t("onboarding.business.typeOtherPlaceholder")}
              aria-label={t("onboarding.business.typeOther")}
              aria-invalid={bad("businessTypeOther") || undefined}
              className={cn("mt-2.5 max-w-sm", bad("businessTypeOther") && "border-danger")}
            />
          )}
          {(bad("businessType") || bad("businessTypeOther")) && <FieldError>{t("onboarding.business.errors.type")}</FieldError>}
        </div>

        <Labeled id="ob-location" label={t("onboarding.business.location")} hint={t("onboarding.business.locationHint")} error={bad("location") ? t("onboarding.business.errors.location") : null}>
          <Input
            id="ob-location"
            value={location}
            onChange={(e) => {
              setLocation(e.target.value);
              clear("location");
            }}
            maxLength={120}
            placeholder={t("onboarding.business.locationPlaceholder")}
            aria-invalid={bad("location") || undefined}
            className={cn("max-w-sm", bad("location") && "border-danger")}
          />
        </Labeled>

        <Labeled id="ob-description" label={t("onboarding.business.description")} hint={t("onboarding.business.descriptionHint")} error={bad("description") ? t("onboarding.business.errors.description") : null}>
          <Textarea
            id="ob-description"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              clear("description");
            }}
            rows={3}
            maxLength={600}
            dir="auto"
            placeholder={t("onboarding.business.descriptionPlaceholder")}
            aria-invalid={bad("description") || undefined}
            className={cn(bad("description") && "border-danger")}
          />
          <p className="mt-1 text-end text-caption text-muted tabular-nums">{description.length}/600</p>
        </Labeled>

        <div>
          <p className="text-body font-semibold">{t("onboarding.business.products")}</p>
          <p className="mb-3 text-caption text-muted">{t("onboarding.business.productsHint")}</p>
          <TagInput
            values={products}
            onChange={(v) => {
              setProducts(v);
              clear("products");
            }}
            placeholder={t("onboarding.business.productPlaceholder")}
            addLabel={t("common.add")}
          />
          {bad("products") && <FieldError>{t("onboarding.business.errors.products")}</FieldError>}
        </div>

        <Labeled id="ob-audience" label={`${t("onboarding.business.audience")} · ${t("common.optional")}`} hint={t("onboarding.business.audienceHint")}>
          <Input id="ob-audience" value={targetAudience} onChange={(e) => setTargetAudience(e.target.value)} maxLength={300} dir="auto" placeholder={t("onboarding.business.audiencePlaceholder")} />
        </Labeled>
      </div>
    </StepFrame>
  );
}

function Labeled({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string | null; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="block text-body font-semibold">
        {label}
      </label>
      {hint && <p className="mb-2.5 text-caption text-muted">{hint}</p>}
      {children}
      {error && <FieldError>{error}</FieldError>}
    </div>
  );
}

function FieldError({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="mt-1.5 text-caption text-danger">
      {children}
    </p>
  );
}
