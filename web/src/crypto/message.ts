import { sodium } from './sodium';
import { b64, unb64 } from './bytes';

export interface PlainMessage {
  t: 'msg';
  body: string;
  sent: number;
  /** v2 formatında: bu mesajın zincir index'i (gönderim sırası, sıfırdan başlar) */
  ratchet?: { i: number };
}

// AAD binds ciphertext to scope + channel + key epoch: the server cannot
// relocate a captured ciphertext into another context or replay it under
// another epoch. Scope: 'ch' = community channel, 'dm' = direct, 'gdm' = group DM.
export type MsgScope = 'ch' | 'dm' | 'gdm';
// optional client binding: a client-generated UUID + timestamp join the AAD so
// a malicious server cannot re-inject the same ciphertext as a "new" message or
// forge its send time. Absent binding keeps the legacy AAD (existing DB rows).
export interface MsgBinding {
  clientId: string;
  clientSentAt: number;
}
// (testler AAD şablonunu doğrudan doğruluyor)
export const aad = (
  scope: MsgScope,
  channelId: string,
  version: number,
  binding?: MsgBinding,
  // v2: ratchet index'i de AAD'ye girer — aynı ciphertext başka bir zincir
  // pozisyonunda oynatılamaz
  ratchetIdx?: number,
): string => {
  let s = `${scope}:${channelId}:v${version}`;
  if (ratchetIdx != null) s += `:i${ratchetIdx}`;
  if (binding) s += `:${binding.clientId}:${binding.clientSentAt}`;
  return s;
};

// --- boyut padding'i (trafik analizi karşıtı) ---
// XChaCha20-Poly1305 içerik gizler ama ciphertext uzunluğu plaintext uzunluğunu
// ele verir; sunucu mesaj uzunluğu profili çıkarabilir. Çözüm: plaintext başına
// 1 magic byte (0x01) + 4 byte LE gövde uzunluğu eklenir ve toplam boyut bir
// bucket'a yuvarlanır (≤256B → 256, ≤1KiB → 1KiB, ≤4KiB → 4KiB, sonrası 4KiB
// adımlarla). Sunucu artık yalnız bucket'ı görür. Eski mesajlar (headersız,
// direkt JSON gövde) ilk byte'ları 0x01 olmadığı için aynen çözülmeye devam eder.
const PAD_MAGIC = 0x01;
// v2: ratchet'li mesaj — magic dışında düzen aynı (uzunluk header + gövde + padding)
const PAD_MAGIC_V2 = 0x02;
const HEADER_LEN = 5; // magic (1) + gövde uzunluğu LE (4)

// header dahil toplam boyutu ait olduğu bucket'a yuvarlar
function paddedSize(total: number): number {
  if (total <= 256) return 256;
  if (total <= 1024) return 1024;
  if (total <= 4096) return 4096;
  return Math.ceil(total / 4096) * 4096;
}

// --- per-gönderici simetrik hash-ratchet (backward secrecy) ---
// NOT: tam Signal Double Ratchet DEĞİL — DH adımı yok (grup ölçeğinde DH ratchet
// MLS gerektirir), yalnızca simetrik ileri-türetim zinciri.
//
// Zincir epoch anahtarından tamamen deterministik türetilir:
//   chain_seed = H(epoch_key || 'ratchet' || sender_user_id)
//   root_0     = chain_seed
//   root_i     = H(root_{i-1} || 'step')
//   msg_key_i  = H(root_i || 'msg')
// Nükleer avantaj: alıcıda kalıcı ratchet state YOKTUR — epoch anahtarı + mesaj
// index'i yeterli; F5 sonrası ve pagination doğal çalışır, cache yalnız hız içindir.
//
// Forward secrecy dürüst sınırı: msg_key_i kullanıldıktan sonra atılır ve root_i'den
// geriye (root_{i-1}, msg_key_{i-1}) türetilemez → güncel bir kök/msg anahtarı
// sızs bile GEÇMİŞ mesajlar korunur. Buna karşılık ileriye doğru kökler her zaman
// türetilebilir olduğundan gelecek korunmaz — bunu DH ratchet'ten alırdık, yok.
// (Epoch anahtarının kendisi sızarsa zincir baştan türetilebilir; bu riski
// anahtar rotasyonu (epoch) sınırlar, ratchet değil.)
const enc = new TextEncoder();
const H = (data: Uint8Array): Uint8Array => sodium.crypto_generichash(32, data, null);
const cat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

// kök önbelleği: per (epoch anahtarı, gönderici) — roots[i] = root_i.
// Bellekte tutulur, kalıcı değil; 32B/kök (10k mesaj ≈ 320KB — kabul).
const rootCache = new Map<string, Uint8Array[]>();

/** zincirin i. kökü — gerekirse epoch anahtarından adım adım (yeniden) türetilir */
export function ratchetRoot(epochKey: Uint8Array, senderId: string, index: number): Uint8Array {
  const ck = `${b64(epochKey)}|${senderId}`;
  let roots = rootCache.get(ck);
  if (!roots) {
    roots = [H(cat(epochKey, enc.encode('ratchet'), enc.encode(senderId)))];
    rootCache.set(ck, roots);
  }
  for (let i = roots.length; i <= index; i++) roots[i] = H(cat(roots[i - 1]!, enc.encode('step')));
  return roots[index]!;
}

/** i. mesajın AEAD anahtarı */
export function ratchetMsgKey(epochKey: Uint8Array, senderId: string, index: number): Uint8Array {
  return H(cat(ratchetRoot(epochKey, senderId, index), enc.encode('msg')));
}

// alıcı tarama üst sınırı: index gövdenin içinde olduğundan alıcı onu ancak
// deneyerek bulur; bozuk/yabancı ciphertext sonsuz döngüye sokmasın diye
// bir epoch içinde bu kadar index'in ötesi "çözülemez" sayılır.
const MAX_RATCHET_SCAN = 10_000;

// gönderici sayacı: index gizli değil (kaba kuvvetle zaten bilinir, zincir kökü
// tahmin edilemez) — localStorage'da per (channel, key_version) basit sayı.
// Gönderimde tüketilir; başarısız POST index'te boşluk bırakabilir, alıcı
// taraması boşlukları doğal atlar.
export function nextSendIndex(channelId: string, version: number): number {
  const k = `pgv.ratchet.${channelId}.${version}`;
  const cur = Number(localStorage.getItem(k) ?? '0');
  localStorage.setItem(k, String(cur + 1));
  return cur;
}

export function encryptText(
  channelId: string,
  version: number,
  key: Uint8Array,
  body: string,
  scope: MsgScope = 'ch',
  binding?: MsgBinding,
  // yalnız test için: eski (headersız) format üret
  noPad = false,
  // verilirse v2 (ratchet'li) format: msg_key_index ile şifreler, index'i hem
  // gövdeye hem AAD'ye bağlar
  ratchet?: { senderId: string; index: number },
): { nonce: string; ciphertext: string } {
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const msg: PlainMessage = { t: 'msg', body, sent: Date.now() };
  if (ratchet) msg.ratchet = { i: ratchet.index };
  const plain = enc.encode(JSON.stringify(msg));
  let payload = plain;
  if (!noPad) {
    payload = new Uint8Array(paddedSize(plain.length + HEADER_LEN));
    payload[0] = ratchet ? PAD_MAGIC_V2 : PAD_MAGIC;
    new DataView(payload.buffer).setUint32(1, plain.length, true);
    payload.set(plain, HEADER_LEN);
  }
  const aeadKey = ratchet ? ratchetMsgKey(key, ratchet.senderId, ratchet.index) : key;
  const ct = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    payload,
    aad(scope, channelId, version, binding, ratchet?.index),
    null,
    nonce,
    aeadKey,
  );
  return { nonce: b64(nonce), ciphertext: b64(ct) };
}

export class DecryptError extends Error {
  constructor() {
    super('mesaj çözülemedi');
  }
}

export function decryptText(
  channelId: string,
  version: number,
  key: Uint8Array,
  nonceB64: string,
  ciphertextB64: string,
  scope: MsgScope = 'ch',
  binding?: MsgBinding,
  // v2 mesajlar için göndericinin zincirini türetmek üzere user id
  senderId?: string,
): PlainMessage {
  const nonce = unb64(nonceB64);
  const ct = unb64(ciphertextB64);
  const open = (k: Uint8Array, idx?: number): Uint8Array | null => {
    try {
      return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
        null,
        ct,
        aad(scope, channelId, version, binding, idx),
        nonce,
        k,
      );
    } catch {
      return null;
    }
  };
  // 1) eski yol: epoch anahtarı (v1 ve headersız format)
  let pt = open(key);
  // 2) v2: index gövdenin içinde şifreli olduğundan alıcı onu deneyerek bulur —
  //    aday index'ler 0'dan yukarı; AAD index'e bağlı olduğundan yalnız doğru
  //    index MAC'ten geçer. Kökler önbellekte yoksa epoch anahtarından türetilir.
  let scanIdx: number | null = null;
  if (!pt && senderId) {
    for (let i = 0; i <= MAX_RATCHET_SCAN && !pt; i++) {
      pt = open(ratchetMsgKey(key, senderId, i), i);
      if (pt) scanIdx = i;
    }
  }
  if (!pt) throw new DecryptError();
  // v1: magic 0x01 + uzunluk; v2: magic 0x02 + uzunluk; eski mesajlar header'sız direkt gövde
  let body = pt;
  if (pt.length >= HEADER_LEN && (pt[0] === PAD_MAGIC || pt[0] === PAD_MAGIC_V2)) {
    const len = new DataView(pt.buffer, pt.byteOffset, pt.byteLength).getUint32(1, true);
    body = pt.subarray(HEADER_LEN, HEADER_LEN + len);
  }
  let msg: PlainMessage;
  try {
    msg = JSON.parse(new TextDecoder().decode(body)) as PlainMessage;
  } catch {
    throw new DecryptError();
  }
  // tarama yoluyla açıldıysa gövdedeki index şifreleme index'iyle uyuşmalı
  if (scanIdx != null && msg.ratchet?.i !== scanIdx) throw new DecryptError();
  return msg;
}
