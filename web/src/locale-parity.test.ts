import { describe, it, expect } from 'vitest';
import tr from './i18n/locales/tr';
import en from './i18n/locales/en';
import de from './i18n/locales/de';
import fr from './i18n/locales/fr';
import es from './i18n/locales/es';

function flatKeys(o: unknown, p = ''): string[] {
  if (o == null || typeof o !== 'object') return [p.replace(/\.$/, '')];
  if (Array.isArray(o)) return [];
  return Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => flatKeys(v, `${p}${k}.`));
}
const trKeys = new Set(flatKeys(tr).filter(Boolean));

describe('i18n locale parity', () => {
  for (const [name, cat] of Object.entries({ en, de, fr, es })) {
    it(`${name} has same keys as tr`, () => {
      const got = new Set(flatKeys(cat).filter(Boolean));
      const missing = [...trKeys].filter((k) => !got.has(k));
      const extra = [...got].filter((k) => !trKeys.has(k));
      expect(missing, `missing in ${name}: ${JSON.stringify(missing)}`).toEqual([]);
      expect(extra, `extra in ${name}: ${JSON.stringify(extra)}`).toEqual([]);
    });
  }
});
