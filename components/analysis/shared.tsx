"use client";

import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { FlaskConical, Info, Ruler, Sparkles } from "lucide-react";
import { useActiveClient } from "@/components/providers/active-client-provider";
import { MediaPlaceholder } from "@/components/shared/media";
import { Skeleton } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { apiFetch, type ApiClientError } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n/provider";
import { cn, intlLocale, toneFor } from "@/lib/utils";
import type { AiTextState, AnalysisPostDto, MediaIcon } from "@/types";

const ICONS: MediaIcon[] = ["coffee", "gift", "cake", "bag", "sparkles", "cup"];

/** A post's image, or the tone artwork when there is none (mock data) or it fails to load. */
export function PostThumb({ post, className }: { post: Pick<AnalysisPostDto, "id" | "mediaUrl" | "caption">; className?: string }) {
  return (
    <MediaPlaceholder
      tone={toneFor(post.id)}
      icon={ICONS[post.id.length % ICONS.length]}
      src={post.mediaUrl}
      alt={post.caption.slice(0, 80)}
      className={cn("shrink-0 rounded-button", className)}
      iconClassName="size-1/3"
    />
  );
}

/** "Measured" vs "estimated" legend and the correlation-not-causation reminder, under every analysis page. */
export function AnalysisFootnote({ className }: { className?: string }) {
  const { t } = useI18n();
  return (
    <div className={cn("mt-8 space-y-1.5 text-caption text-muted", className)} data-testid="analysis-footnote">
      <p className="flex items-start gap-1.5">
        <Ruler className="mt-px size-3.5 shrink-0" aria-hidden="true" />
        {t("analysis.measuredNote")}
      </p>
      <p className="flex items-start gap-1.5">
        <Sparkles className="mt-px size-3.5 shrink-0" aria-hidden="true" />
        {t("analysis.estimatedNote")}
      </p>
      <p className="flex items-start gap-1.5">
        <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
        {t("analysis.correlationNote")}
      </p>
    </div>
  );
}

export function DemoBadge() {
  const { t } = useI18n();
  return (
    <Badge variant="blue" size="sm">
      <FlaskConical />
      {t("analysis.demoData")}
    </Badge>
  );
}

export function MeasuredBadge() {
  const { t } = useI18n();
  return (
    <Badge variant="neutral" size="sm">
      <Ruler />
      {t("analysis.measured")}
    </Badge>
  );
}

/**
 * The AI's explanation, loaded after the numbers: a stored text is shown at once; a missing or
 * outdated one is requested (POST `url`) without blocking anything. When the AI can't write
 * it, a friendly line says so — the numbers and charts on the page never depend on it.
 */
export function AiExplanation<T>({
  queryKey,
  url,
  state,
  title,
  render,
  className,
}: {
  queryKey: readonly unknown[];
  url: string;
  state: AiTextState<T>;
  title: string;
  render: (text: T) => ReactNode;
  className?: string;
}) {
  const { t } = useI18n();
  const { isPreview } = useActiveClient();
  const wanted = !isPreview && (state.status === "none" || state.status === "stale");
  const fresh = useQuery<AiTextState<T>, ApiClientError>({
    queryKey: [...queryKey, "explain", state.status, state.generatedAt],
    queryFn: () => apiFetch<AiTextState<T>>(url, { method: "POST" }),
    enabled: wanted,
    staleTime: Infinity,
    retry: false,
  });
  const current = fresh.data ?? state;
  const writing = wanted && fresh.isPending;
  const unavailable = current.status === "unavailable" || (fresh.isError && !current.text);

  return (
    <Card className={cn("p-4", className)} data-testid="ai-explanation">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-title font-bold">{title}</h2>
        <Badge variant="blue" size="sm">
          <Sparkles />
          {t("analysis.aiEstimate")}
        </Badge>
      </div>
      {current.text && !writing ? (
        <div data-testid="ai-explanation-text">
          {render(current.text)}
          {current.status === "stale" && <p className="mt-3 text-caption text-muted">{t("analysis.aiStale")}</p>}
        </div>
      ) : writing ? (
        <div className="space-y-2" aria-busy="true">
          <p className="text-caption text-muted">{t("analysis.aiWriting")}</p>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      ) : unavailable || isPreview ? (
        <p className="text-body text-muted" data-testid="ai-explanation-unavailable">
          {isPreview ? t("analysis.aiPreview") : fresh.error?.code === "analysis_limit" ? t("errors.analysis_limit") : t("analysis.aiUnavailable")}
        </p>
      ) : null}
    </Card>
  );
}

/** A plain list of AI points, each one sentence. */
export function PointList({ items, className }: { items: string[]; className?: string }) {
  if (!items.length) return null;
  return (
    <ul className={cn("list-disc space-y-1 ps-5 text-body", className)}>
      {items.map((item) => (
        <li key={item} dir="auto">
          {item}
        </li>
      ))}
    </ul>
  );
}

/** "+12%" / "−8%" with colour, or a dash. */
export function SignedPct({ value, className }: { value: number | null; className?: string }) {
  const { locale } = useI18n();
  if (value === null) return <span className={cn("text-muted", className)}>–</span>;
  const text = `${value > 0 ? "+" : value < 0 ? "−" : ""}${new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 1 }).format(Math.abs(value))}%`;
  return <span className={cn("font-semibold tabular-nums", value > 0 ? "text-success" : value < 0 ? "text-danger" : "text-muted", className)}>{text}</span>;
}
