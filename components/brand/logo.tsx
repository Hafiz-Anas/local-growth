import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * Placeholder product mark: a gradient rounded square holding a location pin
 * with a growth arrow — "local" + "growth". Original artwork, not Instagram's glyph.
 */
export function LogoMark({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8 shrink-0", className)} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="32" x2="32" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--lge-ig-1)" />
          <stop offset="0.4" stopColor="var(--lge-ig-2)" />
          <stop offset="0.75" stopColor="var(--lge-ig-3)" />
          <stop offset="1" stopColor="var(--lge-ig-4)" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${id}-g)`} />
      <path
        d="M16 25.5s-6.5-5.9-6.5-11a6.5 6.5 0 0 1 13 0c0 5.1-6.5 11-6.5 11Z"
        fill="none"
        stroke="#fff"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <path d="m13.2 15.4 2.8-2.8 2.8 2.8M16 12.8v4.8" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("text-[22px] leading-none font-bold tracking-[-0.02em]", className)}>
      Local<span className="text-ig-gradient">Growth</span>
    </span>
  );
}

export function Logo({ className, collapsible = false }: { className?: string; collapsible?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      <Wordmark className={collapsible ? "hidden xl:inline" : undefined} />
    </span>
  );
}
