"use client";

import { useState } from "react";

/**
 * An image from another host (Instagram's CDN). Meta's links expire; a failed
 * image is hidden so the placeholder underneath shows instead of a broken icon.
 */
export function RemoteImage({ src, alt = "", className }: { src: string; alt?: string; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (failed === src) return null;
  // eslint-disable-next-line @next/next/no-img-element -- remote CDN URL, no optimisation wanted
  return <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" className={className} onError={() => setFailed(src)} />;
}
