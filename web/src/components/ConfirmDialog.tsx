import { useEffect, useRef, useState } from 'react';
import Modal, { isInTopModal } from './Modal';
import { useT } from '../i18n/I18nProvider';

/** Branded replacement for window.confirm — focus-trapped, ESC to cancel. */
export default function ConfirmDialog({
  title,
  message,
  confirmLabel,
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
  const { t } = useT();
  const ref = useRef<HTMLButtonElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  // ref: window listener closure'unda bayat state okumamak için
  const busyRef = useRef(false);
  const confirm = (): void => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    onConfirm();
  };
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      // üstte başka katman varsa (gelen arama örtüsü, üst modal) bu dialog
      // görünmez durumdadır — Escape/Enter'ı yutmasın
      if (!isInTopModal(wrapRef.current)) return;
      if (document.querySelector('[data-incoming-call]')) return;
      if (e.key === 'Escape') {
        onCancel();
        return;
      }
      if (e.key !== 'Enter' || e.repeat) return;
      // odak bir form elemanındaysa tarayıcının click sentezi zaten tetikler —
      // keydown yolu da ateşlerse onConfirm iki kez çalışır (hesap silme vb.)
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      confirm();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onCancel, onConfirm]);
  return (
    <Modal title={title} onClose={onCancel}>
      <div ref={wrapRef}>
        <p className="mb-4 text-sm text-paper-300">{message}</p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="btn-ghost">
            {t('confirm.cancel')}
          </button>
          <button
            ref={ref}
            onClick={confirm}
            className={danger ? 'btn-stamp' : 'btn-lamp'}
          >
            {busy ? t('confirm.busy') : (confirmLabel ?? t('confirm.defaultConfirm'))}
          </button>
        </div>
      </div>
    </Modal>
  );
}
