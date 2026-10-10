"use client";

import type { ReactNode } from "react";
import { RefreshCw, WifiOff, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiClientError } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

/** Shimmer block in the colour of Instagram's loading placeholders. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-button bg-button-secondary", className)} />;
}

/** Card-shaped skeleton with a few text lines. */
export function SkeletonCard({ lines = 3, className, media = false }: { lines?: number; className?: string; media?: boolean }) {
  return (
    <div aria-hidden="true" className={cn("rounded-panel border border-border p-4", className)}>
      <Skeleton className="mb-4 h-4 w-40" />
      {media && <Skeleton className="mb-4 aspect-[4/3] w-full rounded-card" />}
      <div className="space-y-2.5">
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} className={cn("h-3", i === lines - 1 ? "w-2/3" : "w-full")} />
        ))}
      </div>
    </div>
  );
}

/** Rows of avatar + two text lines, like Instagram's list loading state. */
export function SkeletonList({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <ul aria-hidden="true" className={cn("divide-y divide-separator", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="size-11 shrink-0 rounded-pill" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Page header placeholder (title + subtitle). */
export function SkeletonHeader() {
  return (
    <div aria-hidden="true" className="mb-6 space-y-2.5">
      <Skeleton className="h-6 w-56" />
      <Skeleton className="h-4 w-80 max-w-full" />
    </div>
  );
}

/** Instagram-style empty state: outlined round icon, bold title, muted hint, optional action. */
export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-12 text-center", className)}>
      <span className="mb-3 flex size-16 items-center justify-center rounded-pill border-2 border-foreground">
        <Icon className="size-7" strokeWidth={1.5} aria-hidden="true" />
      </span>
      <p className="text-title font-bold">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-body text-muted">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Shown when a screen or section couldn't load. */
export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const { t } = useI18n();
  const offline = error instanceof ApiClientError && error.code === "network_error";
  return (
    <div role="alert" className={cn("flex flex-col items-center rounded-panel border border-border px-6 py-12 text-center", className)}>
      <span className="mb-3 flex size-16 items-center justify-center rounded-pill border-2 border-foreground">
        {offline ? <WifiOff className="size-7" strokeWidth={1.5} /> : <RefreshCw className="size-7" strokeWidth={1.5} />}
      </span>
      <p className="text-title font-bold">{t("states.loadFailed")}</p>
      <p className="mt-1 max-w-sm text-body text-muted">{errorMessage(error, t)}</p>
      {onRetry && (
        <Button variant="secondary" className="mt-4" onClick={onRetry}>
          {t("states.retry")}
        </Button>
      )}
    </div>
  );
}
