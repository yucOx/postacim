import { useEffect, useRef, useState } from 'react';
import Modal from './Modal';

/** Branded replacement for window.confirm — focus-trapped, ESC to cancel. */
export default function ConfirmDialog({
  title,
  message,
  confirmLabel = 'onayla',
  danger = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') onConfirm();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, onConfirm]);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onCancel}>
      <p className="mb-4 text-sm text-neutral-300">{message}</p>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm text-neutral-400 hover:text-neutral-200">
          vazgeç
        </button>
        <button
          ref={ref}
          onClick={() => {
            if (busy) return;
            setBusy(true);
            onConfirm();
          }}
          className={`rounded-md px-3 py-1.5 text-sm font-medium text-white ${
            danger ? 'bg-red-700 hover:bg-red-600' : 'bg-indigo-600 hover:bg-indigo-500'
          }`}
        >
          {busy ? '…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
