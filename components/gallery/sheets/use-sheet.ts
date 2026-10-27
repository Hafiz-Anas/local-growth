"use client";

import { useState } from "react";
import { useStore, type SheetState } from "@/lib/gallery/store";

/**
 * Open state + data for one sheet type. Keeps the last data while the sheet animates closed,
 * so its content doesn't disappear mid-animation.
 */
export function useSheet<T extends SheetState["type"]>(type: T) {
  const sheet = useStore((s) => s.sheet);
  const close = useStore((s) => s.closeSheet);
  const open = sheet?.type === type;
  const [last, setLast] = useState<Extract<SheetState, { type: T }> | null>(null);
  if (open && sheet !== last) setLast(sheet as Extract<SheetState, { type: T }>);
  const data = (open ? sheet : last) as Extract<SheetState, { type: T }> | null;
  return { open, data, close };
}
