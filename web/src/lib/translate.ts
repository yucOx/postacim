// lib/state katmanı — React hook'ları kullanamaz (store event handler'ları,
// WS olayları component dışında çalışır). Buradan tek bir `t` alıp
// i18n store'undan okuyoruz; interpolate ile aynı davranış.
import { messages, useI18nStore, type MessageKey } from '../i18n/store';

export function translate(key: MessageKey, vars?: Record<string, string | number>): string {
  const parts = key.split('.');
  const leafKey = parts.pop() ?? '';
  let cur: unknown = messages(useI18nStore.getState().locale);
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      cur = undefined;
      break;
    }
  }
  const leaf =
    cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[leafKey] : undefined;
  const str = typeof leaf === 'string' ? leaf : key;
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
}
