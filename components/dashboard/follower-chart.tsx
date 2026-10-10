"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useI18n } from "@/lib/i18n/provider";
import { formatCompact, formatNumber, intlLocale } from "@/lib/utils";
import type { FollowerPoint } from "@/types";

/** Single-series follower line (no legend needed — the card title names it). */
export function FollowerChart({ data }: { data: FollowerPoint[] }) {
  const { locale, dir } = useI18n();
  const dateFmt = new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "short", timeZone: "UTC" });
  const fmtDate = (iso: string) => dateFmt.format(new Date(`${iso}T00:00:00Z`));
  const min = Math.min(...data.map((d) => d.followers));
  const max = Math.max(...data.map((d) => d.followers));
  const pad = Math.max(10, Math.round((max - min) * 0.15));

  return (
    <div className="h-56 w-full" role="img" aria-label={`${fmtDate(data[0].date)} – ${fmtDate(data[data.length - 1].date)}: ${formatNumber(data[0].followers, locale)} → ${formatNumber(data[data.length - 1].followers, locale)}`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id="followerFill" x1="0" y1="0" x2="0" y2="1">
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
            minTickGap={40}
          />
          <YAxis
            orientation={dir === "rtl" ? "right" : "left"}
            domain={[min - pad, max + pad]}
            tickFormatter={(v: number) => formatCompact(v, locale)}
            tick={{ fill: "var(--lge-text-secondary)", fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            width={44}
          />
          <Tooltip
            cursor={{ stroke: "var(--lge-text-secondary)", strokeWidth: 1, strokeDasharray: "3 3" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0].payload as FollowerPoint;
              return (
                <div className="rounded-button bg-elevated px-3 py-2 shadow-menu">
                  <p className="text-caption text-muted">{fmtDate(point.date)}</p>
                  <p className="text-body font-bold tabular-nums">{formatNumber(point.followers, locale)}</p>
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="followers"
            stroke="var(--lge-chart-line)"
            strokeWidth={2}
            fill="url(#followerFill)"
            activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--lge-bg)", fill: "var(--lge-chart-line)" }}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
