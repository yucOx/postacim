import { useEffect } from 'react';
import { create } from 'zustand';

export interface Toast {
  id: number;
  text: string;
  kind: 'error' | 'info' | 'success';
}

interface ToastState {
  toasts: Toast[];
  push: (text: string, kind?: Toast['kind']) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;
export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (text, kind = 'info') => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts.slice(-4), { id, text, kind }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = {
  error: (t: string): void => useToastStore.getState().push(t, 'error'),
  info: (t: string): void => useToastStore.getState().push(t, 'info'),
  success: (t: string): void => useToastStore.getState().push(t, 'success'),
};

const STYLES: Record<Toast['kind'], string> = {
  error: 'border-red-800 bg-red-950/90 text-red-200',
  info: 'border-neutral-700 bg-neutral-900/90 text-neutral-200',
  success: 'border-emerald-800 bg-emerald-950/90 text-emerald-200',
};

export function ToastContainer(): React.JSX.Element {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  // keyboard dismiss for a11y — focus lands on the toast buttons
  useEffect(() => undefined, [toasts]);
  return (
    <div className="pointer-events-none fixed right-4 top-12 z-50 flex flex-col gap-2" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`pointer-events-auto flex items-center gap-2 rounded-md border px-3 py-2 text-sm shadow-lg ${STYLES[t.kind]}`}>
          <span className="max-w-72">{t.text}</span>
          <button onClick={() => dismiss(t.id)} aria-label="kapat" className="text-xs opacity-60 hover:opacity-100">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
