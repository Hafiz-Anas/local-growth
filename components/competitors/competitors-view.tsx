"use client";

import { useState } from "react";
import { Globe, Plus, UsersRound } from "lucide-react";
import { useActiveClient, useFeature } from "@/components/providers/active-client-provider";
import { PageHeader, SectionTitle } from "@/components/shared/page-header";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { useCompetitors } from "@/lib/api/queries";
import { useI18n } from "@/lib/i18n/provider";
import { timeAgo } from "@/lib/utils";
import type { CompetitorDto } from "@/types";
import { CompetitorCard, CompetitorCardSkeleton } from "./competitor-card";
import { CompetitorDialog } from "./competitor-dialog";
import { RemoveCompetitorDialog } from "./remove-competitor-dialog";
import { TrendsPanels } from "./trends-panels";

const GRID = "grid gap-4 sm:grid-cols-2 lg:grid-cols-3";

/** Competitor Insights: tracked accounts as a card grid, then trends. */
export function CompetitorsView() {
  const { t, locale } = useI18n();
  const { isPreview } = useActiveClient();
  const showAccounts = useFeature("competitors.accounts");
  const competitors = useCompetitors(showAccounts);
  const canEdit = showAccounts && !isPreview;

  const [dialog, setDialog] = useState<{ open: boolean; competitor: CompetitorDto | null }>({ open: false, competitor: null });
  const [removing, setRemoving] = useState<CompetitorDto | null>(null);
  const openAdd = () => setDialog({ open: true, competitor: null });

  const updatedAt = competitors.data
    ?.map((c) => c.lastFetchedAt)
    .filter((d): d is string => Boolean(d))
    .sort()
    .at(-1);
  const list = competitors.data ?? [];

  return (
    <div>
      <PageHeader
        title={t("competitors.title")}
        subtitle={t("competitors.subtitle")}
        actions={
          canEdit && (
            <Button onClick={openAdd}>
              <Plus className="size-4" />
              {t("competitors.addCompetitor")}
            </Button>
          )
        }
      />

      <div className="mb-6 flex items-start gap-2.5 rounded-card bg-secondary-bg px-3 py-2.5">
        <Globe className="mt-px size-4 shrink-0 text-muted" aria-hidden="true" />
        <p className="text-caption text-muted">{t("competitors.publicNote")}</p>
      </div>

      {showAccounts && (
        <section className="mb-8" aria-labelledby="tracked-title">
          <SectionTitle
            action={
              updatedAt && (
                <span className="text-caption text-muted" suppressHydrationWarning>
                  {t("competitors.updated", { time: timeAgo(updatedAt, locale) })}
                </span>
              )
            }
          >
            <span id="tracked-title">
              {t("competitors.tracked")}
              {competitors.data && <span className="ms-1.5 text-muted">· {list.length}</span>}
            </span>
          </SectionTitle>

          {competitors.isPending ? (
            <div className={GRID} aria-busy="true">
              {[0, 1, 2].map((i) => (
                <CompetitorCardSkeleton key={i} />
              ))}
            </div>
          ) : competitors.isError ? (
            <ErrorState error={competitors.error} onRetry={() => competitors.refetch()} />
          ) : list.length === 0 ? (
            <EmptyState
              icon={UsersRound}
              title={t("competitors.emptyTitle")}
              hint={t("competitors.emptyHint")}
              className="rounded-panel border border-dashed border-border"
              action={
                canEdit && (
                  <Button onClick={openAdd}>
                    <Plus className="size-4" />
                    {t("competitors.addCompetitor")}
                  </Button>
                )
              }
            />
          ) : (
            <div className={GRID}>
              {list.map((c) => (
                <CompetitorCard
                  key={c.id}
                  competitor={c}
                  onEdit={canEdit ? () => setDialog({ open: true, competitor: c }) : undefined}
                  onRemove={canEdit ? () => setRemoving(c) : undefined}
                />
              ))}
            </div>
          )}
        </section>
      )}

      <TrendsPanels />

      <CompetitorDialog open={dialog.open} competitor={dialog.competitor} onOpenChange={(open) => setDialog((d) => ({ ...d, open }))} />
      <RemoveCompetitorDialog competitor={removing} onOpenChange={(open) => !open && setRemoving(null)} />
    </div>
  );
}
