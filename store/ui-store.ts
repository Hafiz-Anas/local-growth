"use client";

import { create } from "zustand";

/**
 * App-wide feedback: snackbar-style toasts and the "Connect Instagram" prompt.
 * Callable from anywhere (including query/mutation callbacks) through the
 * `notify` helpers below; rendered once by <Feedback />.
 */
export interface Toast {
  id: number;
  message: string;
  tone: "default" | "success" | "error";
  action?: { label: string; href: string };
}

interface UiState {
  toasts: Toast[];
  /** Message for the Instagram-required dialog; null when closed. */
  instagramPrompt: string | null;
  pushToast: (toast: Omit<Toast, "id">) => void;
  dismissToast: (id: number) => void;
  setInstagramPrompt: (message: string | null) => void;
}

let nextId = 1;

export const useUiStore = create<UiState>()((set) => ({
  toasts: [],
  instagramPrompt: null,
  pushToast: (toast) => set((s) => ({ toasts: [...s.toasts.slice(-2), { ...toast, id: nextId++ }] })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setInstagramPrompt: (instagramPrompt) => set({ instagramPrompt }),
}));

export const notify = {
  info: (message: string, action?: Toast["action"]) => useUiStore.getState().pushToast({ message, tone: "default", action }),
  success: (message: string) => useUiStore.getState().pushToast({ message, tone: "success" }),
  error: (message: string, action?: Toast["action"]) => useUiStore.getState().pushToast({ message, tone: "error", action }),
  instagramRequired: (message: string) => useUiStore.getState().setInstagramPrompt(message),
};
