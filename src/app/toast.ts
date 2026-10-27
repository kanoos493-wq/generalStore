/**
 * Toast notifications.
 *
 * Screens previously called `navigation.goBack()` after a save with no feedback,
 * so the user could never tell whether an action landed. A single global store
 * keeps the host mounted once in App and lets any screen fire `showToast()`.
 */
import { create } from 'zustand';

export type ToastTone = 'success' | 'error' | 'info';

interface ToastState {
  /** Null when no toast is visible. */
  message: string | null;
  tone: ToastTone;
  /** Increments on every show so an identical message still re-animates. */
  seq: number;
  show: (message: string, tone?: ToastTone) => void;
  hide: () => void;
}

export const useToastStore = create<ToastState>()(set => ({
  message: null,
  tone: 'success',
  seq: 0,
  show: (message, tone = 'success') =>
    set(state => ({ message, tone, seq: state.seq + 1 })),
  hide: () => set({ message: null }),
}));

/** Fire-and-forget helper usable from callbacks and services. */
export function showToast(message: string, tone: ToastTone = 'success'): void {
  useToastStore.getState().show(message, tone);
}
