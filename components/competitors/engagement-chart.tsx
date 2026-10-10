"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useI18n } from "@/lib/i18n/provider";
import { formatPct, intlLocale } from "@/lib/utils";
import type { EngagementPoint } from "@/types";

/** Weekly engagement rate — same look as the dashboard's follower chart. */
export function EngagementChart({ data }: { data: EngagementPoint[] }) {
  const { locale, dir } = useI18n();
  const dateFmt = new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "short", timeZone: "UTC" });
  const fmtDate = (iso: string) => dateFmt.format(new Date(`${iso}T00:00:00Z`));
  const rates = data.map((d) => d.rate);
  const min = Math.max(0, Math.floor(Math.min(...rates) - 0.5));
  const max = Math.ceil(Math.max(...rates) + 0.5);
  const first = data[0];
  const last = data[data.length - 1];

  return (
    <div className="h-48 w-full" role="img" aria-label={`${fmtDate(first.date)} – ${fmtDate(last.date)}: ${formatPct(first.rate)} → ${formatPct(last.rate)}`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id="engagementFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--lge-chart-line)" stopOpacity={0.18} />
              <stop offset="100%" stopColor="var(--lge-chart-line)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--lge-chart-grid)" />
          <XAxis
            dataKey="date"
            reversed={dir === "rtl"}
            tickFormatter={fmtDate}
            tick={{ fill: "var(--lge-text-secondary)", fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={36}
          />
          <YAxis
            orientation={dir === "rtl" ? "right" : "left"}
            domain={[min, max]}
            tickFormatter={(v: number) => formatPct(v)}
            tick={{ fill: "var(--lge-text-secondary)", fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            width={48}
          />
          <Tooltip
            cursor={{ stroke: "var(--lge-text-secondary)", strokeWidth: 1, strokeDasharray: "3 3" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0].payload as EngagementPoint;
              return (
                <div className="rounded-button bg-elevated px-3 py-2 shadow-menu">
                  <p className="text-caption text-muted">{fmtDate(point.date)}</p>
                  <p className="text-body font-bold tabular-nums">{formatPct(point.rate)}</p>
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="rate"
            stroke="var(--lge-chart-line)"
            strokeWidth={2}
            fill="url(#engagementFill)"
            activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--lge-bg)", fill: "var(--lge-chart-line)" }}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
