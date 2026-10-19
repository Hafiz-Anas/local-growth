"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LocationFields, type LocationValue } from "@/components/onboarding/location-fields";
import { StyleSummaryField } from "@/components/onboarding/style-summary";
import { ErrorState, Skeleton } from "@/components/shared/states";
import { TagInput } from "@/components/shared/tag-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiFetch, type ApiClientError } from "@/lib/api/client";
import { qk, useAction } from "@/lib/api/queries";
import { useI18n } from "@/lib/i18n/provider";
import { notify } from "@/store/ui-store";
import type { BusinessDetailsDto, StyleGuideDto } from "@/types";

/**
 * Settings → Business: the name (taken from Instagram at sign-up), the main products or menu
 * categories, the location in Kuwait, and the one-line photo style — what onboarding asked, editable.
 */
export function BusinessCard() {
  const { t } = useI18n();
  const details = useQuery<BusinessDetailsDto, ApiClientError>({ queryKey: qk.businessDetails, queryFn: () => apiFetch("/api/brand/business") });
  const style = useQuery<StyleGuideDto | null, ApiClientError>({ queryKey: qk.styleGuide, queryFn: () => apiFetch("/api/brand/style") });
  return (
    <Card id="business" className="scroll-mt-[calc(var(--topbar-height)+16px)]">
      <CardHeader className="pb-0">
        <CardTitle>{t("settings.business.title")}</CardTitle>
        <p className="text-caption text-muted">{t("settings.business.hint")}</p>
      </CardHeader>
      <CardContent className="space-y-6 pt-4">
        {details.isPending ? (
          <Skeleton className="h-64" />
        ) : details.isError ? (
          <ErrorState error={details.error} onRetry={() => details.refetch()} />
        ) : (
          <BusinessForm key={JSON.stringify(details.data)} initial={details.data} />
        )}
        {style.isSuccess && <StyleSummaryField guide={style.data} />}
      </CardContent>
    </Card>
  );
}

function BusinessForm({ initial }: { initial: BusinessDetailsDto }) {
  const { t } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState(initial.name);
  const [products, setProducts] = useState(initial.products);
  const [location, setLocation] = useState<LocationValue>({ governorate: initial.governorate, area: initial.area, serviceMode: initial.serviceMode });
  const save = useAction({
    mutationFn: () => apiFetch<BusinessDetailsDto>("/api/brand/business", { method: "PUT", body: { name: name.trim(), products, ...location } }),
    onSuccess: (data) => {
      queryClient.setQueryData(qk.businessDetails, data);
      notify.success(t("settings.business.saved"));
      // The name shows in the header.
      router.refresh();
    },
  });
  // Not a <form>: the products TagInput is one.
  return (
    <div className="space-y-6">
      <div>
        <label htmlFor="business-name" className="mb-1.5 block text-body font-semibold">
          {t("settings.business.name")}
        </label>
        <Input id="business-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} dir="auto" />
        <p className="mt-1 text-caption text-muted">{t("settings.business.nameHint")}</p>
      </div>
      <div>
        <p className="mb-1 text-body font-semibold">{t("onboarding.brand.products")}</p>
        <p className="mb-2 text-caption text-muted">{t("onboarding.brand.productsHint")}</p>
        <TagInput values={products} onChange={setProducts} placeholder={t("onboarding.brand.productsPlaceholder")} addLabel={t("common.add")} />
      </div>
      <LocationFields value={location} onChange={setLocation} />
      <Button onClick={() => save.mutate()} disabled={save.isPending || !name.trim()}>
        {t("common.save")}
      </Button>
    </div>
  );
}
