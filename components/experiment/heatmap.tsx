"use client";

import { Fragment } from "react";
import { useI18n } from "@/lib/i18n/provider";
import { cn, hourLabel } from "@/lib/utils";

const LEVELS = 6;

function level(value: number) {
  return Math.min(LEVELS - 1, Math.floor(value * LEVELS));
}

/** 7-day × 24-hour engagement grid on a single-hue sequential ramp. */
export function EngagementHeatmap({ data }: { data: number[][] }) {
  const { t, tList, locale } = useI18n();
  const days = tList("experiment.days");

  return (
    <div>
      <div className="overflow-x-auto pb-1 scrollbar-none">
        <div className="min-w-[560px]">
          <div className="grid grid-cols-[44px_repeat(24,minmax(0,1fr))] gap-[2px]">
            <span />
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className="text-center text-[10px] text-muted">
                {h % 3 === 0 ? hourLabel(h, locale) : ""}
              </span>
            ))}
            {data.map((row, d) => {
              const label = days[d] ?? String(d);
              return (
                <Fragment key={d}>
                  <span className="flex items-center truncate text-caption text-muted">{label}</span>
                  {row.map((v, h) => (
                    <span
                      key={h}
                      title={`${label} ${hourLabel(h, locale)} · ${Math.round(v * 100)}%`}
                      className={cn("aspect-square rounded-[3px] hover:outline-2 hover:outline-foreground", `heat-${level(v)}`)}
                    />
                  ))}
                </Fragment>
              );
            })}
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-1.5 text-caption text-muted">
        {t("experiment.less")}
        {Array.from({ length: LEVELS }, (_, i) => (
          <span key={i} className={cn("size-3 rounded-[3px]", `heat-${i}`)} />
        ))}
        {t("experiment.more")}
      </div>
    </div>
  );
}
