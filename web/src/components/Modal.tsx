import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useT } from '../i18n/I18nProvider';

const modalStack: HTMLDivElement[] = [];
// iç içe modallarda body scroll kilidi — son modal kapanınca geri gelir
let scrollLocks = 0;
let prevOverflow = '';

/** açık modal var mı — StreamWindow gibi alt katmanların Escape'i yutmaması için */
export function hasOpenModal(): boolean {
  return modalStack.length > 0;
}

/** el, en üstteki modalın içinde mi — ConfirmDialog gibi iç içe katmanlar için */
export function isInTopModal(el: HTMLElement | null): boolean {
  const top = modalStack[modalStack.length - 1];
  return !!top && !!el && (top === el || top.contains(el));
}

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
  // onClose her render'da yeni closure — effect [onClose] bağımlı olursa panel
  // stack'te başa/alta taşınır ve Escape katman sırasını bozar. Ref ile oku,
  // effect yalnız mount'ta çalışsın.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // backdrop click: yalnız basış backdrop'ta başladıysa kapansın (metin
  // seçip panel dışında bırakmak modalı kapatmasın)
  const downOnBackdrop = useRef(false);

  useEffect(() => {
    const panel = panelRef.current;
    if (panel) modalStack.push(panel);
    // odak yönetimi: açılışta panel'e gir, kapanışta eski odağa dön
    const prevFocus = document.activeElement as HTMLElement | null;
    panel?.focus({ preventScroll: true });
    if (scrollLocks === 0) {
      prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    scrollLocks++;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        // En üstteki modal dışında alttaki modallar Escape tuşuyla kapanmasın
        if (modalStack.length > 0 && modalStack[modalStack.length - 1] !== panelRef.current) {
          return;
        }
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      // keep Tab inside the panel while it is open
      if (e.key !== 'Tab' || !panelRef.current) return;
      const focusables = panelRef.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"]):not(:disabled)',
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
      scrollLocks--;
      if (scrollLocks === 0) document.body.style.overflow = prevOverflow;
      if (prevFocus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-night-950/75 p-4"
      role="presentation"
      onPointerDown={(e) => {
        downOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (downOnBackdrop.current && e.target === e.currentTarget) onCloseRef.current();
        downOnBackdrop.current = false;
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="animate-seal-in w-full max-w-96 rounded-lg border border-brass-700/70 bg-night-900 p-5 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.8)] outline-none"
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
