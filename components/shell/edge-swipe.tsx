"use client";

import { ChevronLeft } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { runBackHandler } from "@/lib/gallery/back";
import { useT } from "@/lib/gallery/hooks";
import { useStore } from "@/lib/gallery/store";

const EDGE = 24; // px from the edge where the swipe must start
const DISTANCE = 90; // px to pull before letting go goes back

/**
 * Phone "swipe back": drag in from the left edge (the right edge in Arabic) to return to the previous screen.
 * An open album or drawer handles it first (see lib/back.ts); otherwise it goes back to the previous route in the app.
 * Sheets and the photo viewer have their own swipe-down gesture, so this stays off while they're open.
 */
export function EdgeSwipeBack() {
  const router = useRouter();
  const pathname = usePathname();
  const { dir } = useT();
  const [pull, setPull] = useState(0);
  const history = useRef<string[]>([]);

  // Track in-app routes so the swipe never leaves the app.
  useEffect(() => {
    const h = history.current;
    if (h[h.length - 2] === pathname) h.pop();
    else if (h[h.length - 1] !== pathname) h.push(pathname);
  }, [pathname]);

  useEffect(() => {
    const sign = dir === "rtl" ? -1 : 1;
    let start: { x: number; y: number } | null = null;
    let tracking = false;
    let progress = 0;

    const reset = () => {
      start = null;
      tracking = false;
      progress = 0;
      setPull(0);
    };
    const onStart = (e: TouchEvent) => {
      const s = useStore.getState();
      if (s.sheet || s.viewer || e.touches.length !== 1) return;
      const { clientX: x, clientY: y } = e.touches[0];
      const fromEdge = dir === "rtl" ? window.innerWidth - x : x;
      if (fromEdge <= EDGE) start = { x, y };
    };
    const onMove = (e: TouchEvent) => {
      if (!start) return;
      const dx = (e.touches[0].clientX - start.x) * sign;
      const dy = e.touches[0].clientY - start.y;
      if (!tracking) {
        if (Math.abs(dy) > 12 && Math.abs(dy) > dx) return reset();
        if (dx > 10) tracking = true;
      }
      if (tracking) {
        e.preventDefault();
        progress = Math.max(0, Math.min(1, dx / DISTANCE));
        setPull(progress);
      }
    };
    const onEnd = () => {
      const go = tracking && progress >= 1;
      reset();
      if (!go) return;
      if (runBackHandler()) return;
      if (history.current.length > 1) router.back();
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", reset);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", reset);
    };
  }, [dir, router]);

  if (pull === 0) return null;
  return (
    <div
      aria-hidden
      className="ge pointer-events-none fixed top-1/2 start-0 z-[80] grid size-11 -translate-y-1/2 place-items-center rounded-full border bg-ge-elevated shadow-lg"
      style={{ opacity: 0.35 + pull * 0.65, translate: `${(dir === "rtl" ? -1 : 1) * (pull * 28 - 8)}px 0`, scale: 0.7 + pull * 0.3 }}
    >
      <ChevronLeft className={pull >= 1 ? "size-6 text-ge-brand rtl:rotate-180" : "size-6 text-ge-muted-foreground rtl:rotate-180"} strokeWidth={2.5} />
    </div>
  );
}
