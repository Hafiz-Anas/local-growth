"use client";

import { useEffect, useRef } from "react";

// "Back" for the phone edge swipe: the newest screen-level handler wins (e.g. an open album goes back to Albums),
// otherwise the app goes back to the previous route it navigated from.
const handlers: { current: () => void }[] = [];

/** While `active`, a back swipe calls `onBack` instead of leaving the page. */
export function useBackHandler(active: boolean, onBack: () => void) {
  const ref = useRef(onBack);
  useEffect(() => {
    ref.current = onBack;
  });
  useEffect(() => {
    if (!active) return;
    const entry = { current: () => ref.current() };
    handlers.push(entry);
    return () => {
      handlers.splice(handlers.indexOf(entry), 1);
    };
  }, [active]);
}

/** Runs the newest back handler. Returns false when there is none. */
export function runBackHandler() {
  const top = handlers[handlers.length - 1];
  if (!top) return false;
  top.current();
  return true;
}
