import { create } from 'zustand';
import { LOCALES, type Locale } from './types';
import tr from './locales/tr';
import en from './locales/en';
import de from './locales/de';
import fr from './locales/fr';
import es from './locales/es';

export type Messages = typeof tr;
// messages of other locales must have the SAME key shape as the Turkish
// source of truth; we accept any string value (real translations differ
// per locale) so the structural contract is enforced at the type level,
// not the literal value.
type ShallowKeys<T> = T extends string
  ? never
  : { [K in keyof T]: ShallowKeys<T[K]> }[keyof T];
type SameShapeAs<T> = T extends string
  ? string
  : T extends readonly unknown[]
    ? T
    : { [K in keyof T]: SameShapeAs<T[K]> };
const CATALOGS: Record<Locale, SameShapeAs<Messages>> = { tr, en, de, fr, es };
// runtime lookup needs the original Turkish catalog for the literal type
const TR_CATALOG: Messages = tr;

const STORAGE_KEY = 'postacim.locale';

function isLocale(v: string | null): v is Locale {
  return !!v && (LOCALES as readonly string[]).includes(v);
}

// Default policy (per product decision): if the browser language starts with
// 'tr' the UI is Turkish; everything else falls back to English. The user can
// always override in Settings → Language; the override is persisted.
function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLocale(saved)) return saved;
  } catch {
    // private mode — fall through
  }
  if (typeof navigator !== 'undefined') {
    const lang = navigator.language?.toLowerCase() ?? '';
    if (lang.startsWith('tr')) return 'tr';
  }
  return 'en';
}

interface I18nState {
  locale: Locale;
  setLocale: (l: Locale) => void;
}

export const useI18nStore = create<I18nState>((set) => ({
  locale: initialLocale(),
  setLocale: (l) => {
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // private mode — still update state
    }
    set({ locale: l });
  },
}));

export const messages = (l: Locale): Messages => CATALOGS[l] as unknown as Messages;
void TR_CATALOG;

// path-based key lookup with compile-time safety. 'call.micOn' is typed as
// the literal union of every leaf in the catalog; a typo in a leaf name is
// a TypeScript error.
type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];
export type MessageKey = Leaves<Messages>;
