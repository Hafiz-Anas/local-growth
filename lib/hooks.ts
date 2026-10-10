"use client";

import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

/** `false` during SSR and hydration, `true` afterwards — for UI that depends on browser-only state. */
export function useMounted() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

function subscribeSeconds(callback: () => void) {
  const id = setInterval(callback, 1000);
  return () => clearInterval(id);
}

/** Current time, re-rendering every second. `null` on the server. */
export function useNow(): Date | null {
  const seconds = useSyncExternalStore(
    subscribeSeconds,
    () => Math.floor(Date.now() / 1000),
    () => null,
  );
  return seconds === null ? null : new Date(seconds * 1000);
}
