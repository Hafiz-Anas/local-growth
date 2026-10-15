"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Layers, Megaphone, Plug, Sparkles, User, Wand2 } from "lucide-react";
import { useActiveClient } from "@/components/providers/active-client-provider";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState, Skeleton, SkeletonList } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { apiFetch } from "@/lib/api/client";
import { qk, useAction, useMethods } from "@/lib/api/queries";
import { useI18n } from "@/lib/i18n/provider";
import { METHODS } from "@/lib/analysis/methods";
import { cn, formatCompact, formatNumber, intlLocale } from "@/lib/utils";
import type { Method, MethodPostDto, MethodsDto } from "@/types";
import { AnalysisFootnote, DemoBadge, MeasuredBadge, PostThumb, SignedPct } from "./shared";

/**
 * Insights → Methods: what kind of marketing each post is (AI suggestion, one tap to correct),
 * "promoted" flags, the ranking by engagement and reach (with post counts) and promoted vs normal.
 */
export function MethodsView() {
  const { t } = useI18n();
  const { isPreview } = useActiveClient();
  const queryClient = useQueryClient();
  const query = useMethods();

  // Posts only the caption rules have seen get the AI's suggestion, after the page has shown.
  const suggest = useQuery({
    queryKey: [...qk.methods, "suggest"],
    queryFn: async () => {
      const data = await apiFetch<MethodsDto>("/api/methods/suggest", { method: "POST" });
      queryClient.setQueryData(qk.methods, data);
      return data.ai;
    },
    enabled: !isPreview && query.data?.ai.status === "pending",
    staleTime: Infinity,
    retry: false,
  });

  const update = useAction({
    mutationFn: ({ id, patch }: { id: string; patch: { method?: Method; promoted?: boolean } }) => apiFetch(`/api/methods/${encodeURIComponent(id)}`, { method: "PATCH", body: patch }),
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: qk.methods, exact: true });
      const previous = queryClient.getQueryData<MethodsDto>(qk.methods);
      queryClient.setQueryData<MethodsDto>(qk.methods, (d) => d && { ...d, posts: d.posts.map((p) => (p.id === id ? { ...p, ...patch, ...(patch.method && { source: "user" as const }) } : p)) });
      return { previous };
    },
    onError: (_e, _v, context) => queryClient.setQueryData(qk.methods, context?.previous),
    // The ranking and the promoted comparison are recomputed on the server.
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.methods, exact: true }),
  });

  if (query.isPending) return <MethodsSkeleton />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const data = query.data;
  const aiStatus = suggest.isFetching ? "pending" : (suggest.data?.status ?? data.ai.status);

  return (
    <div>
      <PageHeader title={t("methods.title")} subtitle={t("methods.subtitle")} actions={data.demo && data.connected ? <DemoBadge /> : undefined} />
      {!data.posts.length ? (
        <EmptyState icon={data.connected ? Layers : Plug} title={t(data.connected ? "methods.emptyTitle" : "postPerformance.notConnected")} hint={t("methods.emptyHint")} className="rounded-panel border border-border" />
      ) : (
        <div className="space-y-4">
          <RankingCard data={data} />
          <PromotedCard data={data} />

          <Card className="overflow-hidden">
            <div className="border-b border-separator p-4">
              <h2 className="text-title font-bold">{t("methods.postsTitle")}</h2>
              <p className="mt-1 text-caption text-muted" data-testid="methods-ai-status">
                {aiStatus === "pending" ? t("methods.aiPending") : aiStatus === "unavailable" ? t("methods.aiUnavailable") : t("methods.postsHint")}
              </p>
            </div>
            <ul className="divide-y divide-separator" data-testid="method-posts">
              {data.posts.map((p) => (
                <MethodRow key={p.id} post={p} onChange={(patch) => update.mutate({ id: p.id, patch })} />
              ))}
            </ul>
          </Card>

          {data.competitors.length > 0 && <CompetitorMethods data={data} />}
        </div>
      )}
      <AnalysisFootnote />
    </div>
  );
}

function RankingCard({ data }: { data: MethodsDto }) {
  const { t, locale } = useI18n();
  const max = Math.max(1, ...data.ranking.map((r) => r.avgInteractions));
  return (
    <Card className="p-4">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-title font-bold">{t("methods.rankingTitle")}</h2>
        <MeasuredBadge />
      </div>
      <p className="mb-4 text-caption text-muted">{t("methods.rankingHint")}</p>
      <ol className="space-y-3" data-testid="method-ranking">
        {data.ranking.map((r, i) => (
          <li key={r.method} data-method={r.method}>
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 text-body">
              <span className="font-semibold">
                {r.enoughData && <span className="me-1.5 text-muted tabular-nums">{formatNumber(i + 1, locale)}.</span>}
                {t(`analysis.method.${r.method}`)}
              </span>
              <span className="text-caption text-muted tabular-nums">
                {t("methods.avgLine", { value: formatCompact(Math.round(r.avgInteractions), locale) })}
                {r.avgReach !== null && ` · ${t("methods.reachLine", { value: formatCompact(r.avgReach, locale) })}`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-2 flex-1 overflow-hidden rounded-pill bg-button-secondary">
                <span className={cn("block h-full rounded-pill", r.enoughData ? "bg-primary" : "bg-[var(--lge-chart-alt)]")} style={{ width: `${(r.avgInteractions / max) * 100}%` }} />
              </span>
              <SignedPct value={r.vsAveragePct} className="w-14 shrink-0 text-end text-caption" />
            </div>
            <p className="mt-0.5 text-caption text-muted" data-testid="method-based-on">
              {basedOn(t, r.posts)}
              {!r.enoughData && ` · ${t("methods.tooFew")}`}
            </p>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function PromotedCard({ data }: { data: MethodsDto }) {
  const { t, locale } = useI18n();
  const p = data.promoted;
  return (
    <Card className="p-4" data-testid="promoted-card">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2 className="text-title font-bold">{t("methods.promotedTitle")}</h2>
        <Badge variant="neutral" size="sm">
          {t("methods.markedByYou")}
        </Badge>
      </div>
      <p className="mb-3 text-caption text-muted">{t("methods.promotedHint")}</p>
      {!p.promoted.posts ? (
        <p className="text-body text-muted">{t("methods.noPromoted")}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            {(["promoted", "organic"] as const).map((side) => (
              <div key={side} className="rounded-card border border-border p-3">
                <p className="text-caption text-muted">{t(`methods.${side}Side`)}</p>
                <p className="text-title font-bold tabular-nums">{formatCompact(Math.round(p[side].avgInteractions), locale)}</p>
                <p className="text-caption text-muted">
                  {basedOn(t, p[side].posts)}
                  {p[side].avgReach !== null && ` · ${t("methods.reachLine", { value: formatCompact(p[side].avgReach!, locale) })}`}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-body">
            {p.diffPct !== null && (
              <>
                <SignedPct value={p.diffPct} /> {t("methods.promotedDiff")}
              </>
            )}
            {!p.enoughData && <span className="block text-caption text-muted">{t("methods.promotedFew")}</span>}
          </p>
        </>
      )}
    </Card>
  );
}

/** "Based on 1 post" / "Based on 12 posts". */
const basedOn = (t: (key: string, vars?: Record<string, string | number>) => string, count: number) =>
  count === 1 ? t("methods.basedOnOne") : t("methods.basedOn", { count });

const SOURCE_ICON = { rule: Wand2, ai: Sparkles, user: User } as const;

function MethodRow({ post, onChange }: { post: MethodPostDto; onChange: (patch: { method?: Method; promoted?: boolean }) => void }) {
  const { t, locale } = useI18n();
  const SourceIcon = SOURCE_ICON[post.source];
  return (
    <li className="flex gap-3 px-4 py-3" data-testid="method-post" data-post-id={post.id}>
      <PostThumb post={post} className="size-14" />
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-body" dir="auto">
          {post.caption || "—"}
        </p>
        <p className="mt-0.5 text-caption text-muted tabular-nums">
          {new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "short" }).format(new Date(post.postedAt))} · {t(`analysis.format.${post.format}`)} ·{" "}
          {t("methods.avgLine", { value: formatCompact(post.likes + post.comments, locale) })}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex h-8 items-center gap-1.5 rounded-pill border border-border px-3 text-caption font-semibold outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-primary"
              data-testid="method-picker"
              aria-label={t("methods.changeMethod")}
            >
              {t(`analysis.method.${post.method}`)}
              <ChevronDown className="size-3.5" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {METHODS.map((m) => (
                <DropdownMenuItem key={m} onSelect={() => m !== post.method && onChange({ method: m })} data-testid="method-option">
                  <Check className={cn("size-4", m === post.method ? "opacity-100" : "opacity-0")} />
                  {t(`analysis.method.${m}`)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="inline-flex items-center gap-1 text-caption text-muted" data-testid="method-source">
            <SourceIcon className="size-3.5" aria-hidden="true" />
            {t(`methods.source.${post.source}`)}
          </span>
          <button
            type="button"
            onClick={() => onChange({ promoted: !post.promoted })}
            aria-pressed={post.promoted}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-pill border px-3 text-caption font-semibold transition-colors",
              post.promoted ? "border-warning bg-warning/15 text-warning" : "border-border text-muted hover:bg-hover",
            )}
            data-testid="promoted-toggle"
          >
            <Megaphone className="size-3.5" aria-hidden="true" />
            {t("methods.promoted")}
          </button>
        </div>
      </div>
    </li>
  );
}

function CompetitorMethods({ data }: { data: MethodsDto }) {
  const { t, locale } = useI18n();
  return (
    <Card className="p-4" data-testid="competitor-methods">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2 className="text-title font-bold">{t("methods.competitorsTitle")}</h2>
        <Badge variant="neutral" size="sm">
          {t("analysis.estimated")}
        </Badge>
      </div>
      <p className="mb-3 text-caption text-muted">{t("methods.competitorsHint")}</p>
      <ul className="space-y-3">
        {data.competitors.map((c) => (
          <li key={c.handle}>
            <p className="mb-1 text-body font-semibold">
              <bdi>@{c.handle}</bdi> <span className="text-caption font-normal text-muted">· {basedOn(t, c.posts)}</span>
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {c.methods.map((m) => (
                <li key={m.method}>
                  <Badge variant="outline">
                    {t(`analysis.method.${m.method}`)} · {formatNumber(m.posts, locale)}
                  </Badge>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function MethodsSkeleton() {
  return (
    <div aria-busy="true">
      <div className="mb-6 space-y-2.5">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <Skeleton className="mb-4 h-64 rounded-panel" />
      <div className="rounded-panel border border-border">
        <SkeletonList rows={4} />
      </div>
    </div>
  );
}
