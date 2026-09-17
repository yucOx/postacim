import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useT } from '../i18n/I18nProvider';

const modalStack: HTMLDivElement[] = [];

export default function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useT();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (panelRef.current) modalStack.push(panelRef.current);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        // En üstteki modal dışında alttaki modallar Escape tuşuyla kapanmasın
        if (modalStack.length > 0 && modalStack[modalStack.length - 1] !== panelRef.current) {
          return;
        }
        e.stopPropagation();
        onClose();
        return;
      }
      // keep Tab inside the panel while it is open
      if (e.key !== 'Tab' || !panelRef.current) return;
      const focusables = panelRef.current.querySelectorAll<HTMLElement>(
        'button, input, textarea, select, a[href], [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      if (panelRef.current) {
        const idx = modalStack.indexOf(panelRef.current);
        if (idx !== -1) modalStack.splice(idx, 1);
      }
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-night-950/75 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="animate-seal-in w-full max-w-96 rounded-lg border border-brass-700/70 bg-night-900 p-5 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.8)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between border-b border-night-700 pb-3">
          <h2 className="plate !text-sm !tracking-[0.2em] text-paper-100">{title}</h2>
          <button
            onClick={onClose}
            aria-label={t('modal.close')}
            className="rounded p-1 text-paper-500 transition-colors hover:bg-night-800 hover:text-paper-100"
          >
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
