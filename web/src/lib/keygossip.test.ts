// Faz 6 — istemci-arası head gossip reducer (4 durum makinesi, saf fonksiyon).
// Negatif + senaryo: fork tespiti, geride head, ileri head, sessiz eşleşme.
// Hardening deseni: kendi yankısı, malformed frame, geçersiz hash reddi.
import { describe, expect, it } from 'vitest';
import { classifyKeylogHead, isValidIncomingHead, type IncomingKeylogHead } from './keygossip';
import type { KeyLogHead } from './keytransparency';

const head = (id: number, suffix = 'abcd'): KeyLogHead => ({
  id,
  entry_hash: suffix.padStart(64, 'a'),
});
const incoming = (id: number, hash: string, from = 'u_other'): IncomingKeylogHead => ({
  type: 'keylog_head',
  id,
  hash,
  from,
  community_id: 'c_1',
});

describe('classifyKeylogHead', () => {
  it('kendi head\'imiz null ise sessiz (kendi sync sonucumuz bekleniyor)', () => {
    expect(classifyKeylogHead(null, incoming(5, 'b'.repeat(64)))).toEqual({ kind: 'silence' });
  });

  it('aynı id + aynı hash → silence', () => {
    const h = head(7, 'beef');
    expect(classifyKeylogHead(h, incoming(7, h.entry_hash))).toEqual({ kind: 'silence' });
  });

  it('aynı id + farklı hash → fork (yeniden yazım kanıtı)', () => {
    const h = head(7, 'beef');
    const r = classifyKeylogHead(h, incoming(7, 'c'.repeat(64)));
    expect(r.kind).toBe('fork');
  });

  it('biz gerideyiz (ileri head) → sync tetikle', () => {
    const h = head(3, 'beef');
    const remote = incoming(7, 'd'.repeat(64));
    const r = classifyKeylogHead(h, remote);
    expect(r.kind).toBe('sync');
    if (r.kind === 'sync') expect(r.remote).toEqual(remote);
  });

  it('biz öndeyiz (remote geride) → fork (gözlemci farklı defterde)', () => {
    const h = head(7, 'beef');
    const r = classifyKeylogHead(h, incoming(3, 'd'.repeat(64)));
    expect(r.kind).toBe('fork');
  });
});

describe('isValidIncomingHead — hardening (savunmacı ön kontrol)', () => {
  it('geçerli frame kabul', () => {
    expect(isValidIncomingHead(incoming(5, 'a'.repeat(64)))).toBe(true);
  });

  it('kendi yankısı için de geçerli (reddi çağıran taraf yapar)', () => {
    // isValidIncomingHead yapı kontrolü yapar; from===me kontrolü çağıranın
    // sorumluluğundadır (uygulama: appStore.wireEvents)
    expect(isValidIncomingHead(incoming(5, 'a'.repeat(64), 'me'))).toBe(true);
  });

  it('hash 64 hex değilse red', () => {
    expect(isValidIncomingHead(incoming(5, 'z'.repeat(64)))).toBe(false); // hex dışı
    expect(isValidIncomingHead(incoming(5, 'a'.repeat(63)))).toBe(false); // kısa
    expect(isValidIncomingHead(incoming(5, 'A'.repeat(64)))).toBe(false); // büyük harf
  });

  it('id pozitif 32-bit değilse red', () => {
    expect(isValidIncomingHead(incoming(0, 'a'.repeat(64)))).toBe(false);
    expect(isValidIncomingHead(incoming(-1, 'a'.repeat(64)))).toBe(false);
    expect(isValidIncomingHead(incoming(1.5, 'a'.repeat(64)))).toBe(false);
    expect(isValidIncomingHead(incoming(0x80000000, 'a'.repeat(64)))).toBe(false); // 2^31 dışı
  });

  it('from string değilse red', () => {
    const e = { ...incoming(5, 'a'.repeat(64)), from: 0 };
    expect(isValidIncomingHead(e)).toBe(false);
  });

  it('type yanlışsa red', () => {
    expect(isValidIncomingHead({ ...incoming(5, 'a'.repeat(64)), type: 'other' })).toBe(false);
  });

  it('null/undefined/object dışı red', () => {
    expect(isValidIncomingHead(null)).toBe(false);
    expect(isValidIncomingHead(undefined)).toBe(false);
    expect(isValidIncomingHead('foo')).toBe(false);
  });
});
