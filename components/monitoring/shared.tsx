"use client";

import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n/provider";
import { cn, intlLocale } from "@/lib/utils";
import type { Locale } from "@/config/site";
import type { MonitorItemDto, MonitorStatus } from "@/types";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "in 5 hours" / "خلال 5 ساعات" (Intl handles the plural forms in both languages). */
export function relativeTime(iso: string, locale: Locale, now = Date.now()): string {
  const diff = Date.parse(iso) - now;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: "auto" });
  if (abs < HOUR) return rtf.format(Math.round(diff / MINUTE), "minute");
  if (abs < 2 * DAY) return rtf.format(Math.round(diff / HOUR), "hour");
  return rtf.format(Math.round(diff / DAY), "day");
}

/** When monitoring ends (or ended) and how often it reads the post. */
export function MonitorTiming({ item, className }: { item: MonitorItemDto; className?: string }) {
  const { t, locale } = useI18n();
  if (item.status !== "active") {
    const date = new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(item.endedAt ?? item.endsAt));
    return <p className={className}>{t("monitoring.endedOn", { date })}</p>;
  }
  return (
    <p className={className} suppressHydrationWarning data-testid="monitor-timing">
      {t("monitoring.endsIn", { time: relativeTime(item.endsAt, locale) })} · {t(`monitoring.every.${item.interval}`)}
    </p>
  );
}

const STATUS_VARIANT: Record<MonitorStatus, "success" | "neutral" | "warning"> = { active: "success", ended: "neutral", stopped: "neutral", unavailable: "warning" };

export function MonitorStatusBadge({ status }: { status: MonitorStatus }) {
  const { t } = useI18n();
  return (
    <Badge variant={STATUS_VARIANT[status]} size="sm" data-testid="monitor-status">
      {t(`monitoring.status.${status}`)}
    </Badge>
  );
}

/** Tiny line chart of likes + comments over the monitoring period (no axes; decorative, the numbers are next to it). */
export function MiniChart({ values, className }: { values: number[]; className?: string }) {
  const { dir } = useI18n();
  if (values.length < 2) return <div className={cn("h-10 w-24 rounded-button bg-button-secondary/60", className)} aria-hidden="true" />;
  const w = 96;
  const h = 40;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    return `${dir === "rtl" ? w - x : x},${h - 3 - ((v - min) / span) * (h - 6)}`;
  });
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn("h-10 w-24 shrink-0", className)} aria-hidden="true" data-testid="mini-chart">
      <polyline points={pts.join(" ")} fill="none" stroke="var(--lge-chart-line)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
