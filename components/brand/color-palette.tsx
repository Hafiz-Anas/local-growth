"use client";

import { useEffect, useRef } from "react";
import { Plus, X } from "lucide-react";
import { MAX_BRAND_COLORS } from "@/config/onboarding";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

/** Round swatches; editable ones get a remove button and a "+" that opens the system colour picker. */
export function ColorPalette({
  colors,
  onChange,
  readOnly = false,
  size = "md",
}: {
  colors: string[];
  onChange?: (colors: string[]) => void;
  readOnly?: boolean;
  size?: "sm" | "md";
}) {
  const { t } = useI18n();
  const picker = useRef<HTMLInputElement>(null);
  const swatch = size === "sm" ? "size-7" : "size-11";
  const editable = !readOnly && onChange;
  const canAdd = Boolean(editable) && colors.length < MAX_BRAND_COLORS;

  // React's onChange fires on every drag in the picker; adding a colour should happen once, when it closes.
  const latest = useRef({ colors, onChange });
  useEffect(() => {
    latest.current = { colors, onChange };
  });
  useEffect(() => {
    const input = picker.current;
    if (!input) return;
    const add = () => latest.current.onChange?.([...latest.current.colors, input.value.toLowerCase()]);
    input.addEventListener("change", add);
    return () => input.removeEventListener("change", add);
  }, [canAdd]);

  return (
    <ul className="flex flex-wrap items-center gap-2.5">
      {colors.map((color, i) => (
        <li key={`${color}-${i}`} className="group relative">
          {editable ? (
            <label className={cn("block cursor-pointer rounded-pill border border-border shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)]", swatch)} style={{ background: color }}>
              <span className="sr-only">{t("brand.colors.edit", { color })}</span>
              <input
                type="color"
                value={color}
                onChange={(e) => onChange(colors.map((c, j) => (j === i ? e.target.value.toLowerCase() : c)))}
                className="sr-only"
              />
            </label>
          ) : (
            <span className={cn("block rounded-pill border border-border", swatch)} style={{ background: color }} title={color} />
          )}
          {size === "md" && (
            <span className="mt-1 block text-center font-mono text-[10px] text-muted uppercase" dir="ltr">
              {color.slice(1)}
            </span>
          )}
          {editable && (
            <button
              type="button"
              onClick={() => onChange(colors.filter((_, j) => j !== i))}
              className="absolute -end-1 -top-1 flex size-5 items-center justify-center rounded-pill border border-border bg-background text-muted shadow-sm hover:text-foreground"
              aria-label={t("brand.colors.remove", { color })}
            >
              <X className="size-3" />
            </button>
          )}
        </li>
      ))}
      {canAdd && (
        <li className={cn(size === "md" && "pb-4")}>
          <button
            type="button"
            onClick={() => picker.current?.click()}
            className={cn("flex items-center justify-center rounded-pill border border-dashed border-border text-muted hover:bg-hover hover:text-foreground", swatch)}
            aria-label={t("brand.colors.add")}
          >
            <Plus className="size-5" />
          </button>
          <input ref={picker} type="color" defaultValue="#0095f6" className="sr-only" tabIndex={-1} aria-hidden="true" />
        </li>
      )}
    </ul>
  );
}
