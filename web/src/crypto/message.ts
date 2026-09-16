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

// --- gönderen atfı: Ed25519 imzalı mesajlar (v3) ---
// signer verilirse AEAD çıktısına 64B detached imza eklenir: ciphertext ‖ sig.
// İmza girdisi = ciphertext baytları ‖ utf8(AAD) — AAD zaten scope, kanal,
// key_version, ratchet index ve client binding'i kapsar. Doğrulama, mesaj
// açılmadan ÖNCE göndericinin published Ed25519 anahtarıyla yapılır: sunucu
// sahte sender_id ile mesaj uyduramaz, ciphertext'i başka bağlama taşıyamaz.
//
// Geçiş dönemi: bu özellikten önceki mesajlar imzasızdır — SIGN_CUTOVER_MS'ten
// eski sunucu zaman damgalı imzasız mesajlar kabul edilir, sonrakiler reddedilir.
// (Sabit istemcide yaşar: dağıtım + 2 hafta hoşgörü.)
export const SIGN_CUTOVER_MS = Date.parse('2026-10-01T00:00:00Z');
const SIG_LEN = 64; // crypto_sign_BYTES

export interface SigContext {
  /** göndericinin anahtar defterindeki Ed25519 public key'leri (key değişimi
   *  olabileceği için dizi — herhangi biri doğrularsa geçerli); null/boş =
   *  gönderenin imza anahtarı bilinmiyor → imzalı mesaj reddedilir */
  signPublicKey: Uint8Array[] | null;
  /** sunucu zaman damgası — cutover kuralı buna bakar */
  sentAt: number;
}

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
  // verilirse v3: AEAD çıktısına gönderenin Ed25519 imzası eklenir
  signer?: { signPrivateKey: Uint8Array },
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
  const aadStr = aad(scope, channelId, version, binding, ratchet?.index);
  const ct = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    payload,
    aadStr,
    null,
    nonce,
    aeadKey,
  );
  if (!signer) return { nonce: b64(nonce), ciphertext: b64(ct) };
  const sig = sodium.crypto_sign_detached(cat(ct, enc.encode(aadStr)), signer.signPrivateKey);
  return { nonce: b64(nonce), ciphertext: b64(cat(ct, sig)) };
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
  // v3 doğrulama + cutover bağlamı; verilmezse imzasız mesajlar koşulsuz kabul
  sigCtx?: SigContext,
): PlainMessage {
  const nonce = unb64(nonceB64);
  const ct = unb64(ciphertextB64);
  const tryOpen = (k: Uint8Array, aadStr: string, bytes: Uint8Array): Uint8Array | null => {
    try {
      return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
        null,
        bytes,
        aadStr,
        nonce,
        k,
      );
    } catch {
      return null;
    }
  };
  // v1 (epoch anahtarı) + v2 (ratchet taraması) yolu: hangi AAD ile açıldığını
  // da döner — v3 imzası tam bu AAD üzerinden doğrulanır
  const openAll = (bytes: Uint8Array): { pt: Uint8Array; aadUsed: string; scanIdx: number | null } | null => {
    const legacyAad = aad(scope, channelId, version, binding, undefined);
    const legacy = tryOpen(key, legacyAad, bytes);
    if (legacy) return { pt: legacy, aadUsed: legacyAad, scanIdx: null };
    if (!senderId) return null;
    // v2: index gövdenin içinde şifreli olduğundan alıcı onu deneyerek bulur —
    // aday index'ler 0'dan yukarı; AAD index'e bağlı olduğundan yalnız doğru
    // index MAC'ten geçer. Kökler önbellekte yoksa epoch anahtarından türetilir.
    for (let i = 0; i <= MAX_RATCHET_SCAN; i++) {
      const idxAad = aad(scope, channelId, version, binding, i);
      const pt = tryOpen(ratchetMsgKey(key, senderId, i), idxAad, bytes);
      if (pt) return { pt, aadUsed: idxAad, scanIdx: i };
    }
    return null;
  };
  // 1) imzasız yol: tam ciphertext (v1/v2). Cutover'dan sonra imzasız kabul edilmez.
  const legacy = openAll(ct);
  if (legacy) {
    if (sigCtx && sigCtx.sentAt >= SIGN_CUTOVER_MS) throw new DecryptError();
    return parseBody(legacy.pt, legacy.scanIdx);
  }
  // 2) v3: ciphertext ‖ signature — son 64B imza; gövde v1/v2 yollarından
  //    biriyle açılır, imza göndericinin published anahtarıyla doğrulanır.
  if (ct.length > SIG_LEN) {
    const body = ct.slice(0, ct.length - SIG_LEN);
    const sig = ct.slice(ct.length - SIG_LEN);
    const opened = openAll(body);
    if (opened) {
      const candidates = sigCtx?.signPublicKey;
      if (!candidates || candidates.length === 0) throw new DecryptError();
      const signed = cat(body, enc.encode(opened.aadUsed));
      const ok = candidates.some((pk) => {
        try {
          return sodium.crypto_sign_verify_detached(sig, signed, pk);
        } catch {
          return false;
        }
      });
      if (!ok) throw new DecryptError();
      return parseBody(opened.pt, opened.scanIdx);
    }
  }
  throw new DecryptError();
}

// header (v1: 0x01 / v2: 0x02 + uzunluk; eski: headersız) + JSON + scan çelişki kontrolü
function parseBody(pt: Uint8Array, scanIdx: number | null): PlainMessage {
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
