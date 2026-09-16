// Kaybolan mesajlar — istemci tarafı TTL yardımcıları.
import { describe, expect, it } from 'vitest';
import { TTL_OPTIONS, futureExpiry, isExpired } from './ttl';

describe('isExpired', () => {
  const now = 1_000_000;
  it('null/absent asla süresi dolmuş sayılmaz (TTL kapalı)', () => {
    expect(isExpired(null, now)).toBe(false);
    expect(isExpired(undefined, now)).toBe(false);
  });
  it('sınır: eşit ve geçmiş true, gelecek false', () => {
    expect(isExpired(now, now)).toBe(true);
    expect(isExpired(now - 1, now)).toBe(true);
    expect(isExpired(now + 1, now)).toBe(false);
  });
});

describe('TTL_OPTIONS', () => {
  it('composer seçenekleri: 1 sa / 1 gün / 1 hafta', () => {
    expect(TTL_OPTIONS.map((o) => o.seconds)).toEqual([3_600, 86_400, 604_800]);
    expect(TTL_OPTIONS.map((o) => o.key)).toEqual(['ttl.hour', 'ttl.day', 'ttl.week']);
  });
  it('futureExpiry saniyeyi ms epoch geleceğe çevirir', () => {
    expect(futureExpiry(60, 1_000)).toBe(61_000);
  });
});