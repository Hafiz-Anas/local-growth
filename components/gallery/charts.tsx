"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/gallery/utils";

/* Simple, light charts. One accent hue for single-series data, thin marks with rounded data-ends,
   hover/focus tooltips, and a visually hidden table for screen readers. */

export function BarChart({
  values,
  labels,
  tickLabels,
  format,
  highlight,
  height = 140,
  title,
  onSelect,
}: {
  values: number[];
  /** Full label per bar (tooltip + table). */
  labels: string[];
  /** What to show under each bar: text or a thumbnail. */
  tickLabels?: ReactNode[];
  format: (v: number) => string;
  highlight?: number;
  height?: number;
  title: string;
  onSelect?: (i: number) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...values, 1);
  const active = hover ?? highlight ?? null;
  return (
    <figure className="w-full">
      <div className="relative flex items-end gap-1.5" style={{ height }} onMouseLeave={() => setHover(null)}>
        {/* Recessive gridlines */}
        {[0.5, 1].map((g) => (
          <span key={g} aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-dashed border-ge-border" style={{ bottom: `${g * 100}%` }} />
        ))}
        {values.map((v, i) => {
          const h = Math.max(3, (v / max) * 100);
          const isActive = active === i;
          const Tag = onSelect ? "button" : "div";
          return (
            <Tag
              key={i}
              type={onSelect ? "button" : undefined}
              aria-label={`${labels[i]}: ${format(v)}`}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              onClick={onSelect ? () => onSelect(i) : undefined}
              className="group relative flex h-full flex-1 items-end justify-center rounded-t-md outline-offset-2"
            >
              <span
                className={cn(
                  "w-full max-w-9 rounded-t-[4px] transition-[height,background-color] duration-500",
                  isActive || active === null ? "bg-ge-brand" : "bg-ge-brand/35",
                )}
                style={{ height: `${h}%` }}
              />
              {hover === i && (
                <span className="pointer-events-none absolute bottom-[calc(100%+6px)] z-10 rounded-lg bg-ge-foreground px-2 py-1 text-[11px] font-medium whitespace-nowrap text-ge-background shadow-lg">
                  {labels[i]} • <b>{format(v)}</b>
                </span>
              )}
            </Tag>
          );
        })}
      </div>
      {tickLabels && (
        <div className="mt-1.5 flex gap-1.5" aria-hidden>
          {tickLabels.map((tl, i) => (
            <div key={i} className="flex flex-1 justify-center text-[11px] text-ge-muted-foreground">
              {tl}
            </div>
          ))}
        </div>
      )}
      <SrTable title={title} rows={labels.map((l, i) => [l, format(values[i])])} />
    </figure>
  );
}

export function Heatmap({
  matrix,
  rowLabels,
  colLabels,
  title,
  format,
  lowLabel,
  highLabel,
}: {
  matrix: number[][];
  rowLabels: string[];
  colLabels: string[];
  title: string;
  format: (v: number) => string;
  lowLabel: string;
  highLabel: string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(...matrix.flat());
  return (
    <figure>
      <div className="grid gap-[3px]" style={{ gridTemplateColumns: `auto repeat(${colLabels.length}, minmax(0,1fr))` }}>
        <span />
        {colLabels.map((c) => (
          <span key={c} className="pb-1 text-center text-[10.5px] text-ge-muted-foreground">
            {c}
          </span>
        ))}
        {matrix.map((row, r) => (
          <Row key={r}>
            <span className="pe-2 text-[11px] leading-7 text-ge-muted-foreground">{rowLabels[r]}</span>
            {row.map((v, c) => {
              const key = `${r}-${c}`;
              // Sequential: one hue, light (quiet) -> dark (busy).
              const alpha = 0.08 + (v / max) * 0.92;
              return (
                <span
                  key={key}
                  tabIndex={0}
                  role="img"
                  aria-label={`${rowLabels[r]} ${colLabels[c]}: ${format(v)}`}
                  onMouseEnter={() => setHover(key)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(key)}
                  onBlur={() => setHover(null)}
                  className="relative h-7 rounded-[5px]"
                  style={{ backgroundColor: `color-mix(in oklab, var(--ge-brand) ${Math.round(alpha * 100)}%, transparent)` }}
                >
                  {hover === key && (
                    <span className="pointer-events-none absolute bottom-[calc(100%+4px)] left-1/2 z-10 -translate-x-1/2 rounded-lg bg-ge-foreground px-2 py-1 text-[11px] whitespace-nowrap text-ge-background shadow-lg">
                      {rowLabels[r]} {colLabels[c]} • <b>{format(v)}</b>
                    </span>
                  )}
                </span>
              );
            })}
          </Row>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-end gap-2 text-[11px] text-ge-muted-foreground" aria-hidden>
        {lowLabel}
        <span className="h-2 w-24 rounded-full" style={{ background: "linear-gradient(to right, color-mix(in oklab, var(--ge-brand) 8%, transparent), var(--ge-brand))" }} />
        {highLabel}
      </div>
      <SrTable title={title} rows={matrix.flatMap((row, r) => row.map((v, c) => [`${rowLabels[r]} ${colLabels[c]}`, format(v)]))} />
    </figure>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

/** Horizontal bars with the value written at the end, so identity never relies on color. */
export function HBars({ rows, max }: { rows: { label: ReactNode; value: number; display: string; muted?: boolean }[]; max?: number }) {
  const top = max ?? Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="space-y-3">
      {rows.map((r, i) => (
        <div key={i}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
            <span className="min-w-0 truncate">{r.label}</span>
            <span className="font-semibold tabular-nums">{r.display}</span>
          </div>
          <div className="h-2 rounded-full bg-ge-muted">
            <div
              className={cn("h-full rounded-full transition-[width] duration-700", r.muted ? "bg-ge-neutral-series" : "bg-ge-brand")}
              style={{ width: `${Math.max(2, (r.value / top) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Content mix: three validated categorical slots, 2px gaps, and every share labelled. */
export function StackedBar({ parts }: { parts: { label: string; value: number; display: string; color: "series-1" | "series-2" | "series-3" }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  const color = { "series-1": "bg-ge-series-1", "series-2": "bg-ge-series-2", "series-3": "bg-ge-series-3" };
  return (
    <div>
      <div className="flex h-3 gap-[2px] overflow-hidden rounded-full">
        {parts.map((p) => (
          <span key={p.label} className={cn("h-full", color[p.color])} style={{ width: `${(p.value / total) * 100}%` }} title={`${p.label} ${p.display}`} />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-ge-muted-foreground">
        {parts.map((p) => (
          <span key={p.label} className="inline-flex items-center gap-1">
            <span className={cn("size-2 rounded-full", color[p.color])} aria-hidden />
            {p.label} <b className="font-semibold text-ge-foreground">{p.display}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

function SrTable({ title, rows }: { title: string; rows: string[][] }) {
  return (
    <table className="sr-only">
      <caption>{title}</caption>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (
              <td key={j}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
