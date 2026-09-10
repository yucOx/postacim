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
      <p className="mb-4 text-sm text-paper-300">{message}</p>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn-ghost">
          vazgeç
        </button>
        <button
          ref={ref}
          onClick={() => {
            if (busy) return;
            setBusy(true);
            onConfirm();
          }}
          className={danger ? 'btn-stamp' : 'btn-lamp'}
        >
          {busy ? '…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
