import { create } from 'zustand';
import { X } from 'lucide-react';

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
  error: 'border-stamp-500/70 bg-stamp-100 text-stamp-400',
  info: 'border-brass-600/70 bg-night-850 text-paper-100',
  success: 'border-lamp-600/70 bg-lamp-100 text-lamp-300',
};

export function ToastContainer(): React.JSX.Element {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  return (
    <div className="pointer-events-none fixed right-4 top-12 z-[70] flex flex-col gap-2" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`animate-seal-in pointer-events-auto flex items-center gap-2 rounded-md border px-3 py-2 text-sm shadow-[0_10px_30px_-10px_rgba(0,0,0,0.8)] ${STYLES[t.kind]}`}
        >
          <span className="max-w-72">{t.text}</span>
          <button
            onClick={() => dismiss(t.id)}
            aria-label="kapat"
            className="rounded p-0.5 opacity-60 transition-opacity hover:opacity-100"
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
