// Faz 5b — DH ratchet (v4): zincir KAT, pencere sayaçları, FS/PCS-lite
// sızıntı simülasyonu, negatif senaryolar, v1/v2/v3/v4 karışık geçiş.
// Master kural: kripto değişikliği = negatif senaryo testleri şart.
// Spec: docs/faz5-dh-ratchet-design.md — vektörler: dh-ratchet.vectors.json
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { b64, concat, fromHex, toHex, unb64 } from './bytes';
import { generateSignIdentity } from './identity';
import {
  DH_STEP_MSGS,
  DH_STEP_TTL_MS,
  chainSeed,
  dhAnchor,
  dhMsgKey,
  dhShared,
  dhStepRoot,
  dhVoiceKey,
  dhVoiceKeyAnchor,
  dhVoiceKeyDm,
  encodeDhHeader,
  encodeDhUpdate,
  loadDhStep,
  newDhEphemeral,
  nextDhStep,
  saveDhStep,
  shouldDhStep,
  verifyDhUpdate,
  type DhStepState,
} from './dhratchet';
import {
  DecryptError,
  SIGN_CUTOVER_MS,
  aad,
  decryptText,
  encryptText,
  ratchetRoot,
  type DhDecryptContext,
} from './message';
import { sodium, sodiumReady } from './sodium';

await sodiumReady;

const vectors = JSON.parse(
  readFileSync(new URL('./dh-ratchet.vectors.json', import.meta.url), 'utf8'),
) as {
  inputs: { epoch_key_hex: string; sender_id: string; receiver_static_pub_hex: string; receiver_static_priv_hex: string; dh_step_msgs: number };
  steps: { j: number; eph_priv_hex: string; eph_pub_hex: string; dh_out_hex: string; step_root_hex: string; msg_keys: { l: number; i: number; root_hex: string; msg_key_hex: string }[] }[];
  aad_sample: { scope: string; channel_id: string; epoch_version: number; i: number; dh_pub_hex: string; aad: string };
  message: { body: string; j: number; step_base: number; i: number; dh_pub_hex: string; nonce_b64: string; ciphertext_b64: string; aad: string; signer_seed_hex: string; signer_pub_hex: string; sent: number };
  voice: { note: string; anchor_voice_key_hex: string; dm_alice_priv_hex: string; dm_bob_priv_hex: string; dm_alice_pub_hex: string; dm_bob_pub_hex: string; dm_voice_key_hex: string };
};

// --- ortak kurulum ---
const key = new Uint8Array(32).fill(9);
const SENDER = 'u_1';
// alıcı static: fikstürdeki gerçek X25519 çifti (pub, priv'den yeniden türetilir)
const recv = (() => {
  const priv = fromHex(vectors.inputs.receiver_static_priv_hex);
  return { priv, pub: sodium.crypto_scalarmult_base(priv) };
})();
const senderSign = generateSignIdentity();
const PRE_CUTOVER = SIGN_CUTOVER_MS - 60_000;
const POST_CUTOVER = SIGN_CUTOVER_MS + 60_000;
const dhCtx = (): DhDecryptContext => ({ myPriv: recv.priv });
const sigCtx = () => ({ signPublicKey: [senderSign.signPublicKey], sentAt: PRE_CUTOVER });

// v4 üretim yardımcısı: verilen ephemeral/adım/base ile imzalı DM mesajı
const enc4 = (
  channelId: string,
  eph: { publicKey: Uint8Array; privateKey: Uint8Array },
  dhStep: number,
  stepBase: number,
  index: number,
  body: string,
  peerStaticPub: Uint8Array = recv.pub,
) =>
  encryptText(channelId, 1, key, body, 'dm', undefined, false, { senderId: SENDER, index }, { signPrivateKey: senderSign.signPrivateKey }, {
    dhPriv: eph.privateKey,
    dhPub: eph.publicKey,
    dhStep,
    stepBase,
    peerStaticPub,
  });

const dec = (channelId: string, enc: { nonce: string; ciphertext: string }) =>
  decryptText(channelId, 1, key, enc.nonce, enc.ciphertext, 'dm', undefined, SENDER, sigCtx(), dhCtx());

const openWith = (nonce: Uint8Array, body: Uint8Array, aadStr: string, k: Uint8Array): boolean => {
  try {
    sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, body, aadStr, nonce, k);
    return true;
  } catch {
    return false;
  }
};

describe('DH zincir çekirdeği — KAT vektörleri (dh-ratchet.vectors.json)', () => {
  it('chainSeed v2 simetrik zincirin köküyle bit-bit aynı (tek tanım)', () => {
    const epoch = fromHex(vectors.inputs.epoch_key_hex);
    expect(b64(chainSeed(epoch, vectors.inputs.sender_id))).toBe(b64(ratchetRoot(epoch, vectors.inputs.sender_id, 0)));
  });

  it('her adım: dh_out / step_root / msg anahtarları fikstürle bit-bit aynı', () => {
    const epoch = fromHex(vectors.inputs.epoch_key_hex);
    const seed = chainSeed(epoch, vectors.inputs.sender_id);
    for (const s of vectors.steps) {
      const ephPriv = fromHex(s.eph_priv_hex);
      expect(toHex(sodium.crypto_scalarmult_base(ephPriv))).toBe(s.eph_pub_hex);
      const dhOut = dhShared(ephPriv, recv.pub);
      expect(toHex(dhOut)).toBe(s.dh_out_hex);
      // alıcı tarafı simetrisi: static private × ephemeral public = aynı sır
      expect(toHex(dhShared(recv.priv, fromHex(s.eph_pub_hex)))).toBe(s.dh_out_hex);
      const sroot = dhStepRoot(seed, dhOut, s.j);
      expect(toHex(sroot)).toBe(s.step_root_hex);
      for (const k of s.msg_keys) {
        expect(toHex(dhMsgKey(sroot, k.l))).toBe(k.msg_key_hex);
      }
    }
  });

  it('fikstürdeki tam v4 mesajı çözülür; AAD ve imza anahtarı yeniden hesabı eşleşir', () => {
    const m = vectors.message;
    const aadCalc = aad('dm', 'dm_vektor', 1, undefined, m.i, m.dh_pub_hex);
    expect(aadCalc).toBe(vectors.aad_sample.aad);
    expect(aadCalc).toBe(m.aad);
    const signPub = sodium.crypto_sign_seed_keypair(fromHex(m.signer_seed_hex)).publicKey;
    expect(toHex(signPub)).toBe(m.signer_pub_hex);
    const msg = decryptText(
      'dm_vektor', 1, fromHex(vectors.inputs.epoch_key_hex), m.nonce_b64, m.ciphertext_b64, 'dm', undefined,
      vectors.inputs.sender_id,
      { signPublicKey: [signPub], sentAt: PRE_CUTOVER },
      dhCtx(),
    );
    expect(msg.body).toBe(m.body);
    expect(msg.ratchet?.i).toBe(m.i);
    expect(msg.sent).toBe(m.sent);
  });

  it('yanlış alıcı private ile fikstür mesajı çözülemez', () => {
    const m = vectors.message;
    const stranger = newDhEphemeral();
    expect(() =>
      decryptText('dm_vektor', 1, fromHex(vectors.inputs.epoch_key_hex), m.nonce_b64, m.ciphertext_b64, 'dm', undefined, vectors.inputs.sender_id, undefined, { myPriv: stranger.privateKey }),
    ).toThrow(DecryptError);
  });
});

describe('pencere sayaçları (PCS-lite: M=100 / T=24h)', () => {
  const st: DhStepState = { j: 2, base: 50, ts: 1_000_000 };

  it('state yok / ephemeral kayıp → yeni adım', () => {
    expect(shouldDhStep(null, 0, 1_000_000, true)).toBe(true);
    expect(shouldDhStep(st, 51, 1_000_000, false)).toBe(true); // reload senaryosu
  });
  it('M mesaj doldu → yeni adım; dolmadı → aynı adım', () => {
    expect(shouldDhStep(st, 50 + DH_STEP_MSGS - 1, 1_000_000, true)).toBe(false);
    expect(shouldDhStep(st, 50 + DH_STEP_MSGS, 1_000_000, true)).toBe(true);
  });
  it('T süresi doldu → yeni adım', () => {
    expect(shouldDhStep(st, 51, 1_000_000 + DH_STEP_TTL_MS - 1, true)).toBe(false);
    expect(shouldDhStep(st, 51, 1_000_000 + DH_STEP_TTL_MS, true)).toBe(true);
  });
  it('nextDhStep monotonik: j artar, base = ilk mesajın indexi', () => {
    expect(nextDhStep(st.j, 150, 2_000_000)).toEqual({ j: 3, base: 150, ts: 2_000_000 });
  });
  it('localStorage sayacı: kaydet/oku döngüsü, bozuk kayıt null', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    saveDhStep('dm_c', 1, st);
    expect(loadDhStep('dm_c', 1)).toEqual(st);
    expect(loadDhStep('dm_c', 2)).toBeNull(); // başka epok — ayrı anahtar
    store.set('pgv.dhstep.dm_c.1.primary', '{{bozuk');
    expect(loadDhStep('dm_c', 1)).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe('v4 DM yolu — format ve geçiş', () => {
  it('v4 roundtrip: gövde + global index + başlık alanları', () => {
    const eph = newDhEphemeral();
    const enc = enc4('dm_rt', eph, 4, 200, 207, 'merhaba v4');
    const msg = dec('dm_rt', enc);
    expect(msg.body).toBe('merhaba v4');
    expect(msg.ratchet?.i).toBe(207);
    const head = unb64(enc.ciphertext).slice(0, 40);
    expect(b64(head.slice(0, 32))).toBe(b64(eph.publicKey));
    expect(new DataView(head.buffer).getUint32(32, true)).toBe(4);
    expect(new DataView(head.buffer).getUint32(36, true)).toBe(200);
  });

  it('aynı epokta v1/v2/v3/v4 karışık geçmiş: hepsi okunur', () => {
    const ch = 'dm_mix';
    const v1 = encryptText(ch, 1, key, 'bir', 'dm');
    const v2 = encryptText(ch, 1, key, 'iki', 'dm', undefined, false, { senderId: SENDER, index: 0 });
    const v3 = encryptText(ch, 1, key, 'üç', 'dm', undefined, false, { senderId: SENDER, index: 1 }, { signPrivateKey: senderSign.signPrivateKey });
    const v4 = enc4(ch, newDhEphemeral(), 0, 100, 102, 'dört');
    const read = (e: { nonce: string; ciphertext: string }) =>
      decryptText(ch, 1, key, e.nonce, e.ciphertext, 'dm', undefined, SENDER, sigCtx(), dhCtx());
    expect(read(v1).body).toBe('bir');
    expect(read(v2).body).toBe('iki');
    expect(read(v3).body).toBe('üç');
    expect(read(v4).body).toBe('dört');
  });

  it('out-of-order: sonraki adımın mesajı önce gelir, eski adım yine çözülür', () => {
    const ch = 'dm_ooo';
    const eph0 = newDhEphemeral();
    const eph1 = newDhEphemeral();
    const late = enc4(ch, eph0, 0, 0, 5, 'gecikmiş adım 0'); // l=5
    const early = enc4(ch, eph1, 1, 100, 103, 'taze adım 1'); // l=3
    expect(dec(ch, early).body).toBe('taze adım 1');
    expect(dec(ch, late).body).toBe('gecikmiş adım 0');
    const gap = enc4(ch, eph1, 1, 100, 101, 'l=1 sonradan'); // adım içi boşluk kapanır
    expect(dec(ch, gap).body).toBe('l=1 sonradan');
  });

  it('alıcı taraması adım sınırında durur: l ≥ M ile üretilen mesaj çözülemez', () => {
    const ch = 'dm_cap';
    const eph = newDhEphemeral();
    // kural dışı üretim: l = M pozisyonunda elle şifrele (encryptText bunu reddeder)
    const idx = DH_STEP_MSGS;
    const aadStr = aad('dm', ch, 1, undefined, idx, toHex(eph.publicKey));
    const json = new TextEncoder().encode(JSON.stringify({ t: 'msg', body: 'adım dışı', sent: 1, ratchet: { i: idx } }));
    const payload = new Uint8Array(256);
    payload[0] = 0x04;
    new DataView(payload.buffer).setUint32(1, json.length, true);
    payload.set(json, 5);
    const sroot = dhStepRoot(chainSeed(key, SENDER), dhShared(eph.privateKey, recv.pub), 0);
    const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
    const ct = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(payload, aadStr, null, nonce, dhMsgKey(sroot, DH_STEP_MSGS));
    const full = concat(encodeDhHeader(eph.publicKey, 0, 0), ct);
    expect(() => decryptText(ch, 1, key, b64(nonce), b64(full), 'dm', undefined, SENDER, sigCtx(), dhCtx())).toThrow(DecryptError);
  });
});

describe('negatifler — AAD / imza / başlık (v3 disiplini)', () => {
  it('DH başlığında tek bayt değişimi reddedilir (MAC + imza)', () => {
    const enc = enc4('dm_t1', newDhEphemeral(), 0, 0, 0, 'x');
    const t = unb64(enc.ciphertext);
    t[0] ^= 1;
    expect(() => dec('dm_t1', { nonce: enc.nonce, ciphertext: b64(t) })).toThrow();
  });

  it('iki imzalı v4 mesaj arasında başlık takası reddedilir (AAD d<dh_pub> bağlar)', () => {
    const ch = 'dm_swap';
    const a = unb64(enc4(ch, newDhEphemeral(), 0, 0, 0, 'a').ciphertext);
    const bEnc = enc4(ch, newDhEphemeral(), 1, 100, 103, 'b');
    const b = unb64(bEnc.ciphertext);
    // a'nın imzalı başlığı b'nin gövdesine takılır — MAC ve imza düşer
    const swapped = b64(concat(a.slice(0, 40), b.slice(40)));
    expect(() => dec(ch, { nonce: bEnc.nonce, ciphertext: swapped })).toThrow();
  });

  it('kanal taşıma / epok değişimi / binding bozma reddedilir', () => {
    const bind = { clientId: 'c-b1', clientSentAt: 5 };
    const eph = newDhEphemeral();
    const enc = encryptText('dm_aad', 1, key, 'x', 'dm', bind, false, { senderId: SENDER, index: 0 }, { signPrivateKey: senderSign.signPrivateKey }, {
      dhPriv: eph.privateKey, dhPub: eph.publicKey, dhStep: 0, stepBase: 0, peerStaticPub: recv.pub,
    });
    const open = (channelId: string, version: number, b?: typeof bind) =>
      decryptText(channelId, version, key, enc.nonce, enc.ciphertext, 'dm', b, SENDER, sigCtx(), dhCtx());
    expect(() => open('dm_other', 1, bind)).toThrow();
    expect(() => open('dm_aad', 2, bind)).toThrow();
    expect(() => open('dm_aad', 1, { clientId: 'c-b1', clientSentAt: 6 })).toThrow();
  });

  it('imza düşürme: v4 imzasızlaştırma cutover öncesi kabul, sonrası red', () => {
    const enc = enc4('dm_cut', newDhEphemeral(), 0, 0, 0, 'x');
    const stripped = b64(unb64(enc.ciphertext).slice(0, -64));
    expect(dec('dm_cut', { nonce: enc.nonce, ciphertext: stripped }).body).toBe('x');
    expect(() =>
      decryptText('dm_cut', 1, key, enc.nonce, stripped, 'dm', undefined, SENDER, { signPublicKey: [senderSign.signPublicKey], sentAt: POST_CUTOVER }, dhCtx()),
    ).toThrow(DecryptError);
  });

  it('gönderen imza anahtarı bilinmiyorsa imzalı v4 reddedilir', () => {
    const enc = enc4('dm_unk', newDhEphemeral(), 0, 0, 0, 'x');
    expect(() =>
      decryptText('dm_unk', 1, key, enc.nonce, enc.ciphertext, 'dm', undefined, SENDER, { signPublicKey: null, sentAt: PRE_CUTOVER }, dhCtx()),
    ).toThrow(DecryptError);
  });

  it('gövde baytı değişimi reddedilir', () => {
    const enc = enc4('dm_tamper', newDhEphemeral(), 0, 0, 0, 'x');
    const t = unb64(enc.ciphertext);
    t[t.length - 65] ^= 1;
    expect(() => dec('dm_tamper', { nonce: enc.nonce, ciphertext: b64(t) })).toThrow();
  });

  it('yanlış peer static pub ile üretilen mesaj alıcıda çözülemez', () => {
    const stranger = newDhEphemeral();
    const enc = enc4('dm_peer', newDhEphemeral(), 0, 0, 0, 'x', stranger.publicKey);
    expect(() => dec('dm_peer', enc)).toThrow(DecryptError);
  });
});

describe('FS / PCS-lite sızıntı simülasyonu', () => {
  // saldırgan modeli: epoch anahtarı + tüm başlıklar elinde; verilen DH çıktısı
  // adayıyla adım içi l taramasını dener — bir anahtar açarsa sızıntı yeterli
  const attackerScan = (ch: string, nonceB64: string, raw: Uint8Array, seed: Uint8Array, dhOut: Uint8Array, j: number): boolean => {
    const base = new DataView(raw.buffer, raw.byteOffset).getUint32(36, true);
    const dhPubHex = toHex(raw.slice(0, 32));
    const body = raw.slice(40, raw.length - 64);
    const sroot = dhStepRoot(seed, dhOut, j);
    for (let l = 0; l < DH_STEP_MSGS; l++) {
      if (openWith(unb64(nonceB64), body, aad('dm', ch, 1, undefined, base + l, dhPubHex), dhMsgKey(sroot, l))) return true;
    }
    return false;
  };

  it('gönderici zincir state i sızdı (epoch + sayaçlar + GÜNCEL ephemeral) → önceki adım okunamaz', () => {
    const ch = 'dm_fs';
    const eph0 = newDhEphemeral();
    const eph1 = newDhEphemeral();
    const old = enc4(ch, eph0, 0, 0, 3, 'eski adım'); // adım 0, l=3
    const rawOld = unb64(old.ciphertext);
    const seed = chainSeed(key, SENDER);
    // saldırganın elinde: epoch anahtarı (→ seed), alıcının PUBLIC'i, eph1 private'ı.
    // eski adımın dh_out'u için gereken sır: eph0 private (atıldı) veya alıcı private'ı.
    const wrong = dhShared(eph1.privateKey, rawOld.slice(0, 32)); // mevcut adım private'ı × eski adım public'i
    expect(attackerScan(ch, old.nonce, rawOld, seed, wrong, 0)).toBe(false);
    // dürüst alıcı çözer
    expect(dec(ch, old).body).toBe('eski adım');
  });

  it('PCS-lite: sızıntıdan SONRAKİ DH adımında yeni mesajlar güvenli', () => {
    const ch = 'dm_pcs';
    const eph0 = newDhEphemeral();
    const eph1 = newDhEphemeral();
    enc4(ch, eph0, 0, 0, 3, 'sızıntı öncesi'); // adım 0 — eph0 private saldırgana geçti
    const after = enc4(ch, eph1, 1, 100, 103, 'sızıntı sonrası'); // adım 1 — eph1 kullanıldı, atıldı
    const rawAfter = unb64(after.ciphertext);
    const seed = chainSeed(key, SENDER);
    const dhPub1 = rawAfter.slice(0, 32);
    // sızan eph0 private'ıyla aday DH çıktısı üretilebilir ama açılış yok:
    expect(attackerScan(ch, after.nonce, rawAfter, seed, dhShared(eph0.privateKey, dhPub1), 1)).toBe(false);
    // kontrol (test boş değil): eph1 private sızsaydı, alıcı public'i (herkese açık)
    // ile doğru DH çıktısı üretilip adım açılırdı
    expect(attackerScan(ch, after.nonce, rawAfter, seed, dhShared(eph1.privateKey, recv.pub), 1)).toBe(true);
    // dürüst alıcı çözer
    expect(dec(ch, after).body).toBe('sızıntı sonrası');
  });

  it('adım içi backward secrecy: root_{l=3} sızsa bile l=1 mesajı türetilemez', () => {
    const ch = 'dm_stepfs';
    const eph = newDhEphemeral();
    const m1 = enc4(ch, eph, 0, 0, 1, 'l=1');
    const m3 = enc4(ch, eph, 0, 0, 3, 'l=3'); // l=3 zincir state'i sızdı
    const seed = chainSeed(key, SENDER);
    const sroot = dhStepRoot(seed, dhShared(eph.privateKey, recv.pub), 0);
    const nonce1 = unb64(m1.nonce);
    const body1 = unb64(m1.ciphertext).slice(40, unb64(m1.ciphertext).length - 64);
    const aad1 = aad('dm', ch, 1, undefined, 1, toHex(eph.publicKey));
    // saldırgan root_3'ten yalnız İLERİ yürüyebilir (l ≥ 3 anahtarları) — hiçbiri l=1'i açamaz
    for (const l of [3, 4, 5, 6]) {
      expect(openWith(nonce1, body1, aad1, dhMsgKey(sroot, l))).toBe(false);
    }
    // dürüst anahtar açar
    expect(openWith(nonce1, body1, aad1, dhMsgKey(sroot, 1))).toBe(true);
    expect(dec(ch, m1).body).toBe('l=1');
    expect(dec(ch, m3).body).toBe('l=3');
  });
});

describe('self-update doğrulama yardımcıları (5c öncesi KAT)', () => {
  it('geçerli imza kabul edilir', () => {
    const pub = newDhEphemeral().publicKey;
    const payload = encodeDhUpdate('dm_su', 1, pub);
    const sig = sodium.crypto_sign_detached(payload, senderSign.signPrivateKey);
    expect(verifyDhUpdate(payload, sig, senderSign.signPublicKey)).toBe(true);
  });
  it('yanlış anahtar / bozuk payload reddedilir', () => {
    const pub = newDhEphemeral().publicKey;
    const payload = encodeDhUpdate('dm_su', 1, pub);
    const sig = sodium.crypto_sign_detached(payload, senderSign.signPrivateKey);
    expect(verifyDhUpdate(payload, sig, generateSignIdentity().signPublicKey)).toBe(false);
    const t = payload.slice();
    t[10] ^= 1;
    expect(verifyDhUpdate(t, sig, senderSign.signPublicKey)).toBe(false);
  });
});

// --- Faz 5c: kanal/gdm v4 — epok DH çapası + rekey broadcast + self-update bağlama ---
describe('Faz 5c — epok DH çapası (kanal/gdm)', () => {
  const K1 = new Uint8Array(32).fill(3); // eski epok anahtarı
  const K2 = new Uint8Array(32).fill(7); // rekey broadcast ile dağıtılan yeni epok

  it('çapa deterministik: aynı epok → aynı çift; clamp türetimi tutarlı', () => {
    const a = dhAnchor('ch', K1);
    const b = dhAnchor('ch', K1);
    expect(b64(a.publicKey)).toBe(b64(b.publicKey));
    expect(b64(sodium.crypto_scalarmult_base(a.privateKey))).toBe(b64(a.publicKey));
    expect(b64(dhAnchor('ch', K2).publicKey)).not.toBe(b64(a.publicKey));
  });

  it('kanal (ch) + gdm v4 roundtrip: çapa public ile şifrele, çapa private ile çöz', () => {
    const anchor = dhAnchor('ch', K1);
    for (const [scope, ch] of [['ch', 'ch_v4'], ['gdm', 'gdm_v4']] as const) {
      const eph = newDhEphemeral();
      const enc = encryptText(ch, 1, K1, `${scope} gövde`, scope, undefined, false, { senderId: SENDER, index: 0 }, { signPrivateKey: senderSign.signPrivateKey }, {
        dhPriv: eph.privateKey, dhPub: eph.publicKey, dhStep: 0, stepBase: 0, peerStaticPub: anchor.publicKey,
      });
      const msg = decryptText(ch, 1, K1, enc.nonce, enc.ciphertext, scope, undefined, SENDER, sigCtx(), { myPriv: anchor.privateKey });
      expect(msg.body).toBe(`${scope} gövde`);
      expect(msg.ratchet?.i).toBe(0);
      // alıcı simetrisi: X25519(eph_priv, anchor_pub) = X25519(anchor_priv, eph_pub)
      expect(b64(dhShared(eph.privateKey, anchor.publicKey))).toBe(b64(dhShared(anchor.privateKey, eph.publicKey)));
    }
  });

  it('karışık kanal geçmişi: v1/v2/v3 satırlar çapa dhCtx ile de okunur', () => {
    const ch = 'ch_mix';
    const anchor = dhAnchor('ch', K1);
    const v1 = encryptText(ch, 1, K1, 'bir', 'ch');
    const v2 = encryptText(ch, 1, K1, 'iki', 'ch', undefined, false, { senderId: SENDER, index: 0 });
    const v3 = encryptText(ch, 1, K1, 'üç', 'ch', undefined, false, { senderId: SENDER, index: 1 }, { signPrivateKey: senderSign.signPrivateKey });
    const read = (e: { nonce: string; ciphertext: string }) =>
      decryptText(ch, 1, K1, e.nonce, e.ciphertext, 'ch', undefined, SENDER, sigCtx(), { myPriv: anchor.privateKey });
    expect(read(v1).body).toBe('bir');
    expect(read(v2).body).toBe('iki');
    expect(read(v3).body).toBe('üç');
  });

  it('PCS-lite kanal ölçeği: rekey broadcast sonrası atılan üye (eski epok elinde) geleceği OKUYAMAZ', () => {
    const ch = 'ch_rekey';
    const anchor1 = dhAnchor('ch', K1);
    const anchor2 = dhAnchor('ch', K2);
    const eph2 = newDhEphemeral();
    // rekey sonrası kalan üye mesajı: yeni epok, yeni çapa, yeni seed
    const after = encryptText(ch, 2, K2, 'rekey sonrası', 'ch', undefined, false, { senderId: SENDER, index: 40 }, { signPrivateKey: senderSign.signPrivateKey }, {
      dhPriv: eph2.privateKey, dhPub: eph2.publicKey, dhStep: 0, stepBase: 40, peerStaticPub: anchor2.publicKey,
    });
    const raw = unb64(after.ciphertext);
    const nonce = unb64(after.nonce);
    const body = raw.slice(40, raw.length - 64);
    const dhPub2 = raw.slice(0, 32);
    const aadNew = (l: number) => aad('ch', ch, 2, undefined, 40 + l, toHex(dhPub2));
    // atılan üyenin envanteri: K1 (→ eski seed + eski çapa private), tüm başlıklar
    // (public), broadcast'i yakaladı (key_version=2'yi biliyor — anahtarın kendisini
    // saramaz). Aday DH çıktıları eski malzemeyle üretilir:
    const candidates = [
      dhShared(anchor1.privateKey, dhPub2), // eski çapa × yeni adım public'i
      dhShared(anchor1.privateKey, anchor1.publicKey), // eski çapa kendisiyle
    ];
    for (const dhOut of candidates) {
      for (const seed of [chainSeed(K1, SENDER), chainSeed(K2, SENDER)]) {
        const sroot = dhStepRoot(seed, dhOut, 0);
        for (let l = 0; l < DH_STEP_MSGS; l++) {
          expect(openWith(nonce, body, aadNew(l), dhMsgKey(sroot, l))).toBe(false);
        }
      }
    }
    // dürüst kalan üye (yeni epok bootstrap'tan) açar
    const ok = decryptText(ch, 2, K2, after.nonce, after.ciphertext, 'ch', undefined, SENDER, sigCtx(), { myPriv: anchor2.privateKey });
    expect(ok.body).toBe('rekey sonrası');
  });

  it('gdm rekey: broadcast yakalayan ayrılmış üye sonraki mesajları açamaz (gdm scope)', () => {
    const ch = 'gdm_rekey';
    const anchor1 = dhAnchor('ch', K1);
    const anchor2 = dhAnchor('ch', K2);
    const eph2 = newDhEphemeral();
    const after = encryptText(ch, 2, K2, 'ayrılma sonrası', 'gdm', undefined, false, { senderId: SENDER, index: 9 }, { signPrivateKey: senderSign.signPrivateKey }, {
      dhPriv: eph2.privateKey, dhPub: eph2.publicKey, dhStep: 0, stepBase: 9, peerStaticPub: anchor2.publicKey,
    });
    const raw = unb64(after.ciphertext);
    const nonce = unb64(after.nonce);
    const body = raw.slice(40, raw.length - 64);
    const dhPub2 = raw.slice(0, 32);
    const sroot = dhStepRoot(chainSeed(K1, SENDER), dhShared(anchor1.privateKey, dhPub2), 0);
    for (let l = 0; l < DH_STEP_MSGS; l++) {
      expect(openWith(nonce, body, aad('gdm', ch, 2, undefined, 9 + l, toHex(dhPub2)), dhMsgKey(sroot, l))).toBe(false);
    }
    const ok = decryptText(ch, 2, K2, after.nonce, after.ciphertext, 'gdm', undefined, SENDER, sigCtx(), { myPriv: anchor2.privateKey });
    expect(ok.body).toBe('ayrılma sonrası');
  });

  it('self-update kanonu kanal+epok bağlar: başka kanal/sürüm için doğrulama düşer', () => {
    const pub = newDhEphemeral().publicKey;
    const sig = sodium.crypto_sign_detached(encodeDhUpdate('ch_a', 3, pub), senderSign.signPrivateKey);
    expect(verifyDhUpdate(encodeDhUpdate('ch_b', 3, pub), sig, senderSign.signPublicKey)).toBe(false);
    expect(verifyDhUpdate(encodeDhUpdate('ch_a', 4, pub), sig, senderSign.signPublicKey)).toBe(false);
    expect(verifyDhUpdate(encodeDhUpdate('ch_a', 3, pub), sig, senderSign.signPublicKey)).toBe(true);
  });
});

// --- Faz 5d — ses (SFrame) anahtarı türetimi (spec §7) ---
describe('Faz 5d — ses anahtarı: DH zincirinden türetim', () => {
  const epoch = fromHex(vectors.inputs.epoch_key_hex);
  const vk = vectors.voice;
  const alicePriv = fromHex(vk.dm_alice_priv_hex);
  const bobPriv = fromHex(vk.dm_bob_priv_hex);

  it('KAT: kanal/gdm ses anahtarı fikstürle bit-bit aynı (çapa türetimi)', () => {
    expect(toHex(dhVoiceKeyAnchor(epoch))).toBe(vk.anchor_voice_key_hex);
    // elle yeniden hesap: her üye aynı çifti türetir → aynı DH çıktısı
    const anchor = dhAnchor('ch', epoch);
    expect(toHex(dhVoiceKey(epoch, dhShared(anchor.privateKey, anchor.publicKey))))
      .toBe(vk.anchor_voice_key_hex);
    // determinizm: aynı epok → aynı anahtar (arama başına pin, taraf başına ayrım yok)
    expect(toHex(dhVoiceKeyAnchor(epoch))).toBe(toHex(dhVoiceKeyAnchor(epoch)));
  });

  it('KAT: DM ses anahtarı fikstürle bit-bit aynı; iki taraf AYNI anahtarı türetir', () => {
    // alice tarafı: kendi private'ı × bob'un public'i; bob tarafı tersi
    expect(toHex(dhVoiceKeyDm(epoch, alicePriv, fromHex(vk.dm_bob_pub_hex))))
      .toBe(vk.dm_voice_key_hex);
    expect(toHex(dhVoiceKeyDm(epoch, bobPriv, fromHex(vk.dm_alice_pub_hex))))
      .toBe(vk.dm_voice_key_hex);
    // public'ler private'lardan yeniden türetilebilir (fixture tutarlılığı)
    expect(toHex(sodium.crypto_scalarmult_base(alicePriv))).toBe(vk.dm_alice_pub_hex);
    expect(toHex(sodium.crypto_scalarmult_base(bobPriv))).toBe(vk.dm_bob_pub_hex);
  });

  it('epok ayrımı: farklı epok anahtarı → farklı ses anahtarı; rekey anahtarı çevirir', () => {
    const K2 = new Uint8Array(32).fill(8);
    expect(toHex(dhVoiceKeyAnchor(K2))).not.toBe(vk.anchor_voice_key_hex);
    expect(toHex(dhVoiceKeyDm(K2, alicePriv, fromHex(vk.dm_bob_pub_hex))))
      .not.toBe(vk.dm_voice_key_hex);
  });

  it('alan ayrımı: ses anahtarı ham epok anahtarı DEĞİL ve mesaj zincirinden farklı', () => {
    // eski istemci ham epok anahtarını SFrame'e verirdi — yeni türetim bundan
    // ayrışır: karışık ortamda uyuşmazlık EncryptionError ile görünür (dürüst sınır)
    expect(b64(dhVoiceKeyAnchor(epoch))).not.toBe(b64(epoch));
    expect(b64(dhVoiceKeyDm(epoch, alicePriv, fromHex(vk.dm_bob_pub_hex)))).not.toBe(b64(epoch));
    // mesaj zincirinin j=0 kökünden de farklı (voice seed ayrı alan)
    const anchor = dhAnchor('ch', epoch);
    const msgChainRoot = dhStepRoot(chainSeed(epoch, vectors.inputs.sender_id), dhShared(anchor.privateKey, anchor.publicKey), 0);
    expect(b64(dhVoiceKey(epoch, dhShared(anchor.privateKey, anchor.publicKey)))).not.toBe(b64(msgChainRoot));
  });
});
