"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Rocket, Send } from "lucide-react";
import { BrandContextView } from "@/components/brand/brand-context-view";
import { BrandPostGrid } from "@/components/brand/brand-post-grid";
import { ColorPalette } from "@/components/brand/color-palette";
import { ErrorState, Skeleton } from "@/components/shared/states";
import { TimeAgo } from "@/components/shared/time-ago";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { PROGRESS_STEPS, stepNumber } from "@/config/onboarding";
import { useAdminBrand } from "@/lib/api/admin";
import { apiFetch, type ApiClientError } from "@/lib/api/client";
import { qk } from "@/lib/api/queries";
import { useI18n } from "@/lib/i18n/provider";
import { notify } from "@/store/ui-store";
import type { AdminBusinessDto } from "@/types";

/** Onboarding status of a client, with "Send onboarding invite" (takes the client's users through the wizard). */
export function ClientOnboardingCard({ business }: { business: AdminBusinessDto }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const inProgress = business.onboardingStatus === "in_progress";
  const n = Math.min(stepNumber(business.onboardingStep), PROGRESS_STEPS.length);
  const hasUsers = business.users.some((u) => u.status === "active");

  const invite = useMutation<{ recipients: number; business: AdminBusinessDto }, ApiClientError>({
    mutationFn: () => apiFetch(`/api/admin/businesses/${business.id}/onboarding-invite`, { method: "POST" }),
    onSuccess: ({ recipients, business: updated }) => {
      queryClient.setQueryData(qk.admin.business(business.id), updated);
      queryClient.invalidateQueries({ queryKey: qk.admin.businesses });
      queryClient.invalidateQueries({ queryKey: qk.admin.onboarding });
      queryClient.invalidateQueries({ queryKey: qk.admin.activity(business.id) });
      notify.success(t("admin.onboarding.inviteSent", { count: recipients }));
    },
  });

  return (
    <Card className="mb-6">
      <CardHeader>
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <Rocket className="size-5" aria-hidden="true" />
            {t("admin.onboarding.title")}
          </CardTitle>
          <CardDescription>
            {business.source === "self_signup" ? t("admin.onboarding.selfSignup") : t("admin.onboarding.adminCreated")}
            {business.onboardingInvitedAt && (
              <>
                {" · "}
                {t("admin.onboarding.invitedAt")} <TimeAgo iso={business.onboardingInvitedAt} />
              </>
            )}
          </CardDescription>
        </div>
        {inProgress ? (
          <Badge variant="blue">{t("adminOnboarding.atStep", { n, total: PROGRESS_STEPS.length, name: t(`onboarding.steps.${business.onboardingStep}.short`) })}</Badge>
        ) : (
          <Badge variant="success">{t("adminOnboarding.onboarded")}</Badge>
        )}
      </CardHeader>
      <div className="flex flex-wrap items-center gap-3 px-4 pb-4">
        {!inProgress && (
          <Button variant="secondary" onClick={() => setConfirm(true)} disabled={invite.isPending || !hasUsers}>
            {invite.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {t("admin.onboarding.invite")}
          </Button>
        )}
        {!hasUsers && !inProgress && <p className="text-caption text-muted">{t("admin.onboarding.noUsers")}</p>}
        {(business.source === "self_signup" || business.onboardingInvitedAt) && (
          <Link href="/admin/onboarding" className="text-caption font-semibold text-primary hover:text-link">
            {t("admin.onboarding.details")}
          </Link>
        )}
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t("admin.onboarding.inviteTitle")}
        description={t("admin.onboarding.inviteBody")}
        confirmLabel={t("admin.onboarding.invite")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => invite.mutate()}
      />
    </Card>
  );
}

/** The client's brand context and brand posts, read-only. */
export function ClientBrandCard({ businessId }: { businessId: string }) {
  const { t } = useI18n();
  const brand = useAdminBrand(businessId);

  return (
    <section className="mb-6" aria-labelledby="client-brand-title">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="client-brand-title" className="text-title font-bold">
          {t("brand.profile.title")}
        </h2>
        {brand.data?.context && (
          <span className="text-caption text-muted">
            {t("brand.profile.version", { version: brand.data.context.version })}
            {brand.data.context.editedByUser && ` · ${t("brand.profile.edited")}`} · {t("admin.onboarding.readOnly")}
          </span>
        )}
      </div>
      {brand.isPending ? (
        <Skeleton className="h-48 rounded-panel" />
      ) : brand.isError ? (
        <ErrorState error={brand.error} onRetry={() => brand.refetch()} />
      ) : (
        <div className="space-y-4">
          {brand.data.context ? (
            <BrandContextView context={brand.data.context} readOnly />
          ) : (
            <Card className="p-4">
              <p className="text-body text-muted">{t("admin.onboarding.noBrand")}</p>
              {brand.data.basics.colors.length > 0 && (
                <div className="mt-3">
                  <ColorPalette colors={brand.data.basics.colors} readOnly size="sm" />
                </div>
              )}
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle>{t("brand.posts.title")}</CardTitle>
              <Badge variant="neutral">{brand.data.posts.length}</Badge>
            </CardHeader>
            <div className="px-4 pb-4">
              {brand.data.posts.length === 0 ? (
                <p className="text-body text-muted">{t("brand.posts.empty")}</p>
              ) : (
                <BrandPostGrid posts={brand.data.posts} className="max-w-[520px]" />
              )}
            </div>
          </Card>
        </div>
      )}
    </section>
  );
}
