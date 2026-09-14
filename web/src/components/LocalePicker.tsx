import { useState, useRef, useEffect } from 'react';
import { Check, Globe } from 'lucide-react';
import { useI18nStore } from '../i18n/store';
import { LOCALES, LOCALE_LABEL, LOCALE_FLAG, type Locale } from '../i18n/types';

/** Compact language switcher. Two visual variants:
 *  - "icon"  : just the globe + active flag, used in dense headers
 *  - "full"  : flag + native name, used on the login screen
 * Click opens a small dropdown listing every supported locale with a check
 * next to the active one. Selection writes the i18n store + localStorage
 * (handled in the store) and is reflected on the next render. */
export default function LocalePicker({ variant = 'icon' }: { variant?: 'icon' | 'full' }): React.ReactNode {
  const locale = useI18nStore((s) => s.locale);
  const setLocale = useI18nStore((s) => s.setLocale);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // dış tıklama → kapat
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="dil"
        className={`flex items-center gap-1.5 rounded-sm border border-night-700 text-paper-300 transition-colors hover:border-brass-600 hover:text-paper-100 ${
          variant === 'full' ? 'px-2 py-1 text-xs' : '!px-2 !py-1 !text-xs btn-ghost border-night-700'
        }`}
      >
        <Globe size={13} />
        <span aria-hidden>{LOCALE_FLAG[locale]}</span>
        {variant === 'full' && <span>{LOCALE_LABEL[locale]}</span>}
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute right-0 top-full z-50 mt-1 min-w-[10rem] overflow-hidden rounded-md border border-brass-600/70 bg-night-900 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.85)]"
        >
          {LOCALES.map((l) => (
            <LocaleOption
              key={l}
              code={l}
              active={locale === l}
              onPick={(c) => {
                setLocale(c);
                setOpen(false);
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function LocaleOption({
  code,
  active,
  onPick,
}: {
  code: Locale;
  active: boolean;
  onPick: (l: Locale) => void;
}): React.ReactNode {
  return (
    <li>
      <button
        type="button"
        role="option"
        aria-selected={active}
        onClick={() => onPick(code)}
        className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm transition-colors ${
          active ? 'bg-lamp-100/40 text-paper-50' : 'text-paper-300 hover:bg-night-800 hover:text-paper-100'
        }`}
      >
        <span aria-hidden className="text-base leading-none">
          {LOCALE_FLAG[code]}
        </span>
        <span className="flex-1">{LOCALE_LABEL[code]}</span>
        {active && <Check size={13} className="text-lamp-300" aria-hidden />}
      </button>
    </li>
  );
}
