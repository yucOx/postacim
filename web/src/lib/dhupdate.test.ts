// Faz 5c — self-update duyuru işleme: kanon ayrıştırma, Ed25519 reddi, TOFU pin.
// Negatif senaryolar şart: kripto değişikliği = yanlış anahtar/kanal reddi testli.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { b64, toHex, unb64 } from '../crypto/bytes';
import { generateSignIdentity } from '../crypto/identity';
import { newDhEphemeral } from '../crypto/dhratchet';
import { sodium, sodiumReady } from '../crypto/sodium';
import { encodeDhUpdatePayload, ingestDhUpdate, resetDhUpdatePins, verifyNotice } from './dhupdate';

await sodiumReady;

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});

const alice = generateSignIdentity();
const CH = 'ch_dhupd';

beforeEach(() => {
  store.clear();
  resetDhUpdatePins();
});

const payloadOf = (channelId = CH, version = 3, sign = alice.signPrivateKey, pub = newDhEphemeral().publicKey): string =>
  encodeDhUpdatePayload(channelId, version, pub, sign);

describe('dh_update duyurusu', () => {
  it('geçerli duyuru doğrulanır, alanlar ayrışır ve pin düşer', () => {
    const pub = newDhEphemeral().publicKey;
    const payload = payloadOf(CH, 5, alice.signPrivateKey, pub);
    const notice = verifyNotice(CH, payload, [alice.signPublicKey]);
    expect(notice).not.toBeNull();
    expect(notice!.channelId).toBe(CH);
    expect(notice!.version).toBe(5);
    expect(toHex(notice!.dhPub)).toBe(toHex(pub));
    // defterde birden çok anahtar (yenilenme) — herhangi biri doğrular
    expect(verifyNotice(CH, payload, [generateSignIdentity().signPublicKey, alice.signPublicKey])).not.toBeNull();
    expect(ingestDhUpdate('u_victim', CH, payload, [alice.signPublicKey])).toBe('ok');
    expect(JSON.parse(store.get('pgv.dhupdates.v1')!)).toEqual({
      [CH]: { u_victim: { version: 5, pub: b64(pub) } },
    });
  });

  it('yanlış Ed25519 anahtarı reddedilir (bad-signature, pin düşmez)', () => {
    const payload = payloadOf();
    expect(verifyNotice(CH, payload, [generateSignIdentity().signPublicKey])).toBeNull();
    expect(ingestDhUpdate('u_fake', CH, payload, [generateSignIdentity().signPublicKey])).toBe('bad-signature');
    expect(store.get('pgv.dhupdates.v1')).toBeUndefined();
  });

  it('duyuru pub/imza baytı bozulursa imza düşer', () => {
    const payload = payloadOf();
    const raw = unb64(payload);
    raw[raw.length - 65] ^= 1; // imzadan hemen önceki son pub baytı
    expect(ingestDhUpdate('u_x', CH, b64(raw), [alice.signPublicKey])).toBe('bad-signature');
  });

  it('başka kanal için üretilen payload frame kanalıyla uyuşmazsa reddedilir', () => {
    const payload = payloadOf('ch_other', 3); // aynı uzunlukta kanal adı → boyut testi geçmez
    expect(ingestDhUpdate('u_v', CH, payload, [alice.signPublicKey])).toBe('bad-signature');
    const longer = payloadOf('ch_other_xlong', 3); // farklı uzunluk → biçim reddi
    expect(ingestDhUpdate('u_v', CH, longer, [alice.signPublicKey])).toBe('malformed');
  });

  it('kırpık / bozuk gövde malformed', () => {
    expect(ingestDhUpdate('u_v', CH, payloadOf().slice(0, -8), [alice.signPublicKey])).toBe('malformed');
    expect(ingestDhUpdate('u_v', CH, '!!!@', [alice.signPublicKey])).toBe('malformed');
  });

  it('gönderenin defter anahtarı bilinmiyorsa unknown-sender (koşulsuz red)', () => {
    expect(ingestDhUpdate('u_ghost', CH, payloadOf(), null)).toBe('unknown-sender');
    expect(ingestDhUpdate('u_ghost', CH, payloadOf(), [])).toBe('unknown-sender');
  });
});
