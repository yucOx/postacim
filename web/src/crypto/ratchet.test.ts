import { describe, expect, it, vi } from 'vitest';
import { b64, randomBytes, unb64 } from './bytes';
import {
  DecryptError,
  aad,
  decryptText,
  encryptText,
  nextSendIndex,
  ratchetMsgKey,
  ratchetRoot,
} from './message';
import { sodium, sodiumReady } from './sodium';

await sodiumReady;

// v2 (ratchet'li) üretim yardımcısı
const enc2 = (
  channelId: string,
  version: number,
  key: Uint8Array,
  senderId: string,
  index: number,
  body: string,
) => encryptText(channelId, version, key, body, 'ch', undefined, false, { senderId, index });

describe('per-gönderici simetrik hash-ratchet (format v2)', () => {
  const key = randomBytes(32);
  const SENDER = 'u_1';

  it('v2 roundtrip — gövdede ratchet.i görünür', () => {
    const { nonce, ciphertext } = enc2('ch_r', 1, key, SENDER, 0, 'merhaba');
    const m = decryptText('ch_r', 1, key, nonce, ciphertext, 'ch', undefined, SENDER);
    expect(m.body).toBe('merhaba');
    expect(m.ratchet?.i).toBe(0);
  });

  it('ardışık indexler bağımsız anahtar kullanır ve sırayla çözülür', () => {
    for (const i of [0, 1, 2]) {
      const { nonce, ciphertext } = enc2('ch_seq', 1, key, SENDER, i, 'm' + i);
      const m = decryptText('ch_seq', 1, key, nonce, ciphertext, 'ch', undefined, SENDER);
      expect(m.body).toBe('m' + i);
      expect(m.ratchet?.i).toBe(i);
    }
  });

  it('v1 (0x01) ve headersız eski format hâlâ çözülür', () => {
    const v1 = encryptText('ch_old', 1, key, 'v1 mesaj', 'ch');
    expect(decryptText('ch_old', 1, key, v1.nonce, v1.ciphertext, 'ch').body).toBe('v1 mesaj');
    const raw = encryptText('ch_old', 1, key, 'daha eski', 'ch', undefined, true);
    // senderId verilse bile eski yol önce epoch anahtarıyla dener
    expect(decryptText('ch_old', 1, key, raw.nonce, raw.ciphertext, 'ch', undefined, SENDER).body).toBe('daha eski');
  });

  it('AAD index bağlaması: aynı anahtar başka indexte, başka anahtar aynı indexte reddedilir', () => {
    const { nonce, ciphertext } = enc2('ch_aad', 1, key, SENDER, 5, 'x');
    const n = unb64(nonce);
    const ct = unb64(ciphertext);
    const open = (msgKey: Uint8Array, idx: number) =>
      sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ct, aad('ch', 'ch_aad', 1, undefined, idx), n, msgKey);
    expect(() => open(ratchetMsgKey(key, SENDER, 5), 6)).toThrow(); // doğru anahtar, yanlış index
    expect(() => open(ratchetMsgKey(key, SENDER, 6), 5)).toThrow(); // yanlış anahtar, doğru index
    expect(open(ratchetMsgKey(key, SENDER, 5), 5)).toBeTruthy(); // ikisi de doğru
  });

  it('gövdedeki ratchet.i şifreleme indexiyle uyuşmazsa reddedilir', () => {
    // sahte senaryo: msg_key_6 ile şifrelendi ama gövde i=5 diyor
    const plain = new TextEncoder().encode(
      JSON.stringify({ t: 'msg', body: 'x', sent: Date.now(), ratchet: { i: 5 } }),
    );
    const payload = new Uint8Array(256);
    payload[0] = 0x02;
    new DataView(payload.buffer).setUint32(1, plain.length, true);
    payload.set(plain, 5);
    const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
    const ct = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
      payload,
      aad('ch', 'ch_forge', 1, undefined, 6),
      null,
      nonce,
      ratchetMsgKey(key, SENDER, 6),
    );
    expect(() =>
      decryptText('ch_forge', 1, key, b64(nonce), b64(ct), 'ch', undefined, SENDER),
    ).toThrow(DecryptError);
  });

  it("cache'siz taze epoch anahtarıyla 500. mesaj çözülür (stateless yeniden türetim)", () => {
    const fresh = randomBytes(32); // yeni epoch anahtarı → kök cache'de yok
    const { nonce, ciphertext } = enc2('ch_big', 3, fresh, 'u_fresh', 499, 'beş yüzüncü');
    expect(decryptText('ch_big', 3, fresh, nonce, ciphertext, 'ch', undefined, 'u_fresh').body).toBe('beş yüzüncü');
  });

  it('out-of-order: i=7, i=5ten önce çözülür', () => {
    const m7 = enc2('ch_ooo', 1, key, SENDER, 7, 'yedi');
    const m5 = enc2('ch_ooo', 1, key, SENDER, 5, 'beş');
    // araya başka göndericinin mesajı da girsin — zincirler karışmaz
    const other = enc2('ch_ooo', 1, key, 'u_2', 3, 'öteki');
    expect(decryptText('ch_ooo', 1, key, m7.nonce, m7.ciphertext, 'ch', undefined, SENDER).body).toBe('yedi');
    expect(decryptText('ch_ooo', 1, key, other.nonce, other.ciphertext, 'ch', undefined, 'u_2').body).toBe('öteki');
    expect(decryptText('ch_ooo', 1, key, m5.nonce, m5.ciphertext, 'ch', undefined, SENDER).body).toBe('beş');
  });

  it('başka göndericinin zinciri ve senderIDsız eski yol v2yi çözemez', () => {
    const { nonce, ciphertext } = enc2('ch_snd', 1, key, SENDER, 0, 'x');
    expect(() => decryptText('ch_snd', 1, key, nonce, ciphertext, 'ch', undefined, 'u_baskasi')).toThrow(DecryptError);
    expect(() => decryptText('ch_snd', 1, key, nonce, ciphertext, 'ch')).toThrow(DecryptError);
  });

  it('root_10 sızsa bile root_9dan türeyen mesaj açılamaz (tek yönlülük)', () => {
    const { nonce, ciphertext } = enc2('ch_leak', 1, key, SENDER, 9, 'dokuzuncu');
    const root9 = ratchetRoot(key, SENDER, 9);
    const root10 = ratchetRoot(key, SENDER, 10);
    // ileri türetim tek yönlü: root_10, root_9dan türetilir; geri yol yok
    expect(b64(root10)).not.toBe(b64(root9));
    // saldırgan root_10 elindeyken türetebildiği anahtar msg_key_10dur —
    // msg_key_9 = H(root_9 || 'msg') gerektirir, root_9 ise root_10dan çıkarılamaz
    const n = unb64(nonce);
    const ct = unb64(ciphertext);
    const tryOpen = (mk: Uint8Array) => {
      try {
        sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ct, aad('ch', 'ch_leak', 1, undefined, 9), n, mk);
        return true;
      } catch {
        return false;
      }
    };
    expect(tryOpen(ratchetMsgKey(key, SENDER, 9))).toBe(true);
    expect(tryOpen(ratchetMsgKey(key, SENDER, 10))).toBe(false);
  });
});

describe('gönderici sayacı (localStorage)', () => {
  it('kanal/version başına ayrı ve artan', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    expect(nextSendIndex('ch_a', 1)).toBe(0);
    expect(nextSendIndex('ch_a', 1)).toBe(1);
    expect(nextSendIndex('ch_a', 2)).toBe(0); // yeni key_version → yeni sayaç
    expect(nextSendIndex('ch_b', 1)).toBe(0); // başka kanal → ayrı sayaç
    expect(nextSendIndex('ch_a', 1)).toBe(2);
    vi.unstubAllGlobals();
  });
});