"use client";

import Image from "next/image";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/gallery/utils";

/* ---------- Brand ---------- */

/** Placeholder logo mark: a rising line in a rounded square. Our own mark, not Instagram's. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden className={cn("size-7", className)}>
      <rect width="48" height="48" rx="13" className="fill-ge-brand" />
      <path d="M12 31.5 20.5 23l6 5.5L36 18.5" fill="none" stroke="white" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="36" cy="18.5" r="3.2" fill="white" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <LogoMark />
      <span className="text-[17px] font-semibold tracking-tight" dir="ltr">
        Growth Engine
      </span>
    </span>
  );
}

/* ---------- Avatars ---------- */

export function Avatar({ src, alt, size = 32, ring, className }: { src?: string; alt: string; size?: number; ring?: boolean; className?: string }) {
  return (
    <span
      className={cn("relative inline-grid shrink-0 place-items-center rounded-full", ring && "p-[2px] ring-2 ring-ge-brand", className)}
      style={{ width: size, height: size }}
    >
      {src ? (
        <Image unoptimized src={src} alt={alt} width={size} height={size} className="size-full rounded-full bg-ge-muted object-cover" />
      ) : (
        <span className="grid size-full place-items-center rounded-full bg-ge-muted text-xs font-semibold text-ge-muted-foreground uppercase">
          {alt.replace(/^@/, "").slice(0, 2)}
        </span>
      )}
    </span>
  );
}

const TINTS = [
  "bg-[#f3e4d4] text-[#7a4a1d] dark:bg-[#3a2a1a] dark:text-[#f0c79c]",
  "bg-[#dfeee4] text-[#1f5c39] dark:bg-[#15301f] dark:text-[#9fe0b8]",
  "bg-[#e3e8f5] text-[#2b4580] dark:bg-[#1b2440] dark:text-[#a9bdf0]",
  "bg-[#f4e0e4] text-[#7d2f40] dark:bg-[#3a1c23] dark:text-[#f2a9b9]",
  "bg-[#ece4f3] text-[#59357a] dark:bg-[#2a1d38] dark:text-[#cfb2ef]",
  "bg-[#f1ecd6] text-[#6b5a12] dark:bg-[#33301a] dark:text-[#e8d98a]",
];

/** Customers get initials, never photos of faces. */
export function InitialsAvatar({ name, tint, size = 44 }: { name: string; tint: number; size?: number }) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span
      aria-hidden
      className={cn("grid shrink-0 place-items-center rounded-full font-semibold", TINTS[tint % TINTS.length])}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials}
    </span>
  );
}

/* ---------- Buttons ---------- */

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "outline";
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
};

export function Btn({ variant = "primary", size = "md", icon, className, children, type = "button", ...props }: BtnProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-[10px] font-semibold whitespace-nowrap transition-[background-color,transform,opacity] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-[18px] [&_svg]:shrink-0",
        size === "sm" && "h-8 px-3 text-[13px] [&_svg]:size-4",
        size === "md" && "h-10 px-4 text-sm",
        size === "lg" && "h-12 px-5 text-[15px]",
        variant === "primary" && "bg-ge-primary text-ge-primary-foreground hover:bg-ge-primary/90",
        variant === "secondary" && "bg-ge-secondary text-ge-secondary-foreground hover:bg-ge-secondary/70",
        variant === "outline" && "border bg-ge-background hover:bg-ge-muted",
        variant === "ghost" && "text-ge-foreground hover:bg-ge-muted",
        variant === "danger" && "bg-ge-destructive/10 text-ge-destructive hover:bg-ge-destructive/15",
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}

export function IconBtn({ label, className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "relative grid size-10 shrink-0 place-items-center rounded-full text-ge-foreground transition-colors hover:bg-ge-muted active:scale-95 [&_svg]:size-6",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/* ---------- Segmented control (iOS style) ---------- */

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  className?: string;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={cn("flex rounded-[10px] bg-ge-muted p-[3px]", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          type="button"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-8 flex-1 rounded-[8px] px-3 text-[13px] font-semibold whitespace-nowrap text-ge-muted-foreground transition-all",
            value === o.value && "bg-ge-background text-ge-foreground shadow-sm dark:bg-ge-secondary",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- Chips ---------- */

export function Chip({
  active,
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium whitespace-nowrap transition-colors [&_svg]:size-3.5",
        active ? "border-ge-foreground bg-ge-foreground text-ge-background" : "bg-ge-background hover:bg-ge-muted",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/* ---------- Layout bits ---------- */

export function Section({ title, action, children, className, id }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cn("scroll-mt-20", className)}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-3 px-4 lg:px-0">
          {title && <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-2xl border bg-ge-card", className)}>{children}</div>;
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-8 py-16 text-center">
      <div className="mb-4 grid size-16 place-items-center rounded-full border-2 border-ge-foreground/80 [&_svg]:size-8">{icon}</div>
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mt-1 max-w-xs text-sm text-ge-muted-foreground">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Skel({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-ge-muted", className)} />;
}

export function Delta({ value, unit = "%", lang, className }: { value: number; unit?: "%" | "pt"; lang: "en" | "ar"; className?: string }) {
  const up = value >= 0;
  const abs = Math.abs(value).toLocaleString(lang === "ar" ? "ar-KW-u-nu-arab" : "en-GB", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const suffix = unit === "%" ? (lang === "ar" ? "٪" : "%") : lang === "ar" ? " نقطة" : " pt";
  return (
    <span className={cn("inline-flex items-center text-xs font-semibold", up ? "text-ge-good" : "text-ge-bad", className)} dir="ltr">
      <span aria-hidden>{up ? "▲" : "▼"}</span>
      <span className="ms-0.5" dir={lang === "ar" ? "rtl" : "ltr"}>
        {abs}
        {suffix}
      </span>
    </span>
  );
}
