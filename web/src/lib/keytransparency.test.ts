// Anahtar defteri zincir doğrulaması — saf fonksiyonlar: geçerli zincir kabul,
// kopuk prev_hash / yanlış entry_hash / id atlama / head çelişkisi reddedilir.
import { describe, expect, it } from 'vitest';
import {
  GENESIS_HASH,
  checkOwnEntry,
  entryHash,
  headFingerprint,
  verifyChain,
  type KeyLogEntry,
} from './keytransparency';

const keyOf = (i: number): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  bytes[0] = i; // deterministik görünüm değil — sadece b64 üret
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};

/** n satırlık geçerli zincir; userIds[i]/keys[i] ayarlanabilir */
async function makeChain(
  n: number,
  opts: { userIds?: string[]; keys?: string[]; signs?: (string | null)[] } = {},
): Promise<KeyLogEntry[]> {
  const out: KeyLogEntry[] = [];
  let prev = GENESIS_HASH;
  for (let i = 0; i < n; i++) {
    const userId = opts.userIds?.[i] ?? `user-${i}`;
    const publicKey = opts.keys?.[i] ?? keyOf(i);
    const sign = opts.signs?.[i] ?? null;
    const hash = await entryHash(prev, userId, publicKey, sign);
    out.push({
      id: i + 1,
      user_id: userId,
      public_key: publicKey,
      sign_public_key: sign,
      prev_hash: prev,
      entry_hash: hash,
      created_at: 0,
    });
    prev = hash;
  }
  return out;
}

describe('verifyChain', () => {
  it('geçerli zincir kabul edilir, head son kayıttır', async () => {
    const chain = await makeChain(3);
    const r = await verifyChain(chain, null);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.head).toEqual({ id: 3, entry_hash: chain[2]!.entry_hash });
  });

  it('kopuk prev_hash reddedilir', async () => {
    const chain = await makeChain(3);
    chain[1]!.prev_hash = GENESIS_HASH; // 1'in ucu 0'a bitişik olamaz
    expect((await verifyChain(chain, null)).ok).toBe(false);
  });

  it("yanlış entry_hash reddedilir", async () => {
    const chain = await makeChain(3);
    chain[1]!.entry_hash = 'f'.repeat(64);
    expect((await verifyChain(chain, null)).ok).toBe(false);
  });

  it('id atlama reddedilir', async () => {
    const chain = await makeChain(3);
    chain.splice(1, 1); // 2 numaralı kayıt yok — 3 doğrudan 1'e bağlanamaz
    expect((await verifyChain(chain, null)).ok).toBe(false);
  });

  it('başlangıcı 1 olmayan defter reddedilir', async () => {
    const chain = await makeChain(2, { userIds: ['x', 'y'] });
    chain[0]!.id = 5;
    chain[1]!.id = 6;
    // prev_hash hâlâ tutarlı ama id'ler 1'den başlamıyor
    expect((await verifyChain(chain, null)).ok).toBe(false);
  });

  it('bilinen head ile aynı hash → kabul', async () => {
    const chain = await makeChain(3);
    const r = await verifyChain(chain, { id: 2, entry_hash: chain[1]!.entry_hash });
    expect(r.ok).toBe(true);
  });

  it('aynı id’de farklı head hash → yeniden yazım, reddedilir', async () => {
    const chain = await makeChain(3);
    const r = await verifyChain(chain, { id: 2, entry_hash: 'f'.repeat(64) });
    expect(r.ok).toBe(false);
  });

  it('bilinen head defterin önündeyse → geri alınmış, reddedilir', async () => {
    const chain = await makeChain(3);
    const r = await verifyChain(chain, { id: 9, entry_hash: '0'.repeat(64) });
    expect(r.ok).toBe(false);
  });

  it('imza anahtarlı kayıtlar genişletilmiş formülle doğrulanır', async () => {
    const chain = await makeChain(2, { signs: [keyOf(50), null] });
    expect((await verifyChain(chain, null)).ok).toBe(true);
  });

  it('imza anahtarı sonradan değiştirilen kayıt reddedilir', async () => {
    const chain = await makeChain(2, { signs: [keyOf(50), null] });
    chain[0]!.sign_public_key = keyOf(51); // hash girdisi artık uyuşmaz
    expect((await verifyChain(chain, null)).ok).toBe(false);
  });
});

describe('checkOwnEntry', () => {
  const myKey = keyOf(99);

  it('kendi satırı eldeki key ile aynıysa match', async () => {
    const chain = await makeChain(3, { userIds: ['a', 'b', 'me'], keys: [keyOf(1), keyOf(2), myKey] });
    expect(checkOwnEntry(chain, 'me', myKey)).toBe('match');
  });

  it('kendi satırı başka key’se mismatch', async () => {
    const chain = await makeChain(3, { userIds: ['a', 'b', 'me'], keys: [keyOf(1), keyOf(2), myKey] });
    expect(checkOwnEntry(chain, 'me', keyOf(98))).toBe('mismatch');
  });

  it('kayıt yoksa missing', async () => {
    const chain = await makeChain(3);
    expect(checkOwnEntry(chain, 'me', myKey)).toBe('missing');
  });

  it('birden çok satır varsa en günceli sayılır (key değişimi)', async () => {
    const oldKey = keyOf(10);
    const newKey = keyOf(11);
    const chain = await makeChain(3, { userIds: ['me', 'b', 'me'], keys: [oldKey, keyOf(2), newKey] });
    expect(checkOwnEntry(chain, 'me', newKey)).toBe('match');
    expect(checkOwnEntry(chain, 'me', oldKey)).toBe('mismatch');
  });
});

describe('headFingerprint', () => {
  it('entry_hash’in ilk 16 hex’i 4’lü gruplanır', () => {
    const fp = headFingerprint({ id: 7, entry_hash: '0123456789abcdef' + 'f'.repeat(48) });
    expect(fp).toBe('0123 4567 89ab cdef');
  });
});