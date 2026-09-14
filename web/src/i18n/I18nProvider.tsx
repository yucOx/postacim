import { createContext, useContext, useMemo } from 'react';
import { useI18nStore, messages, type MessageKey } from './store';

/** Translate a leaf key (e.g. 'call.micOn') into the active locale's
 *  string. Variables are passed as {name} placeholders, e.g.
 *    t('call.screenPromptTitle', { name: 'X' })
 *  — substituted at lookup time so locales can reorder.
 *  Missing keys fall back to the Turkish catalog (the source of truth)
 *  so the UI never shows a blank string. */
const I18nContext = createContext<{ t: (k: MessageKey, vars?: Record<string, string | number>) => string } | null>(null);

function lookup(cat: ReturnType<typeof messages>, k: string): string | undefined {
  const parts = k.split('.');
  let cur: unknown = cat;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return typeof cur === 'string' ? cur : undefined;
}

function interpolate(s: string, vars: Record<string, string | number> | undefined): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
}

export function I18nProvider({ children }: { children: React.ReactNode }): React.ReactNode {
  const locale = useI18nStore((s) => s.locale);
  const value = useMemo(() => {
    const cat = messages(locale);
    const fallback = messages('tr');
    const t = (k: MessageKey, vars?: Record<string, string | number>): string =>
      interpolate(lookup(cat, k) ?? lookup(fallback, k) ?? k, vars);
    return { t };
  }, [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT(): { t: (k: MessageKey, vars?: Record<string, string | number>) => string } {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // safe fallback when a component renders outside the provider (e.g. tests)
    const cat = messages(useI18nStore.getState().locale);
    const fallback = messages('tr');
    return {
      t: (k, vars) => interpolate(lookup(cat, k) ?? lookup(fallback, k) ?? k, vars),
    };
  }
  return ctx;
}
