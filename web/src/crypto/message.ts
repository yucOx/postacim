import { sodium } from './sodium';
import { b64, unb64 } from './bytes';

export interface PlainMessage {
  t: 'msg';
  body: string;
  sent: number;
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
const aad = (scope: MsgScope, channelId: string, version: number, binding?: MsgBinding): string =>
  binding
    ? `${scope}:${channelId}:v${version}:${binding.clientId}:${binding.clientSentAt}`
    : `${scope}:${channelId}:v${version}`;

// --- boyut padding'i (trafik analizi karşıtı) ---
// XChaCha20-Poly1305 içerik gizler ama ciphertext uzunluğu plaintext uzunluğunu
// ele verir; sunucu mesaj uzunluğu profili çıkarabilir. Çözüm: plaintext başına
// 1 magic byte (0x01) + 4 byte LE gövde uzunluğu eklenir ve toplam boyut bir
// bucket'a yuvarlanır (≤256B → 256, ≤1KiB → 1KiB, ≤4KiB → 4KiB, sonrası 4KiB
// adımlarla). Sunucu artık yalnız bucket'ı görür. Eski mesajlar (headersız,
// direkt JSON gövde) ilk byte'ları 0x01 olmadığı için aynen çözülmeye devam eder.
const PAD_MAGIC = 0x01;
const HEADER_LEN = 5; // magic (1) + gövde uzunluğu LE (4)

// header dahil toplam boyutu ait olduğu bucket'a yuvarlar
function paddedSize(total: number): number {
  if (total <= 256) return 256;
  if (total <= 1024) return 1024;
  if (total <= 4096) return 4096;
  return Math.ceil(total / 4096) * 4096;
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
): { nonce: string; ciphertext: string } {
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const plain = new TextEncoder().encode(
    JSON.stringify({ t: 'msg', body, sent: Date.now() } satisfies PlainMessage),
  );
  let payload = plain;
  if (!noPad) {
    payload = new Uint8Array(paddedSize(plain.length + HEADER_LEN));
    payload[0] = PAD_MAGIC;
    new DataView(payload.buffer).setUint32(1, plain.length, true);
    payload.set(plain, HEADER_LEN);
  }
  const ct = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    payload,
    aad(scope, channelId, version, binding),
    null,
    nonce,
    key,
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
): PlainMessage {
  let pt: Uint8Array;
  try {
    pt = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      unb64(ciphertextB64),
      aad(scope, channelId, version, binding),
      unb64(nonceB64),
      key,
    );
  } catch {
    throw new DecryptError();
  }
  // yeni format: magic 0x01 + uzunluk; eski mesajlar header'sız direkt gövde
  let body = pt;
  if (pt.length >= HEADER_LEN && pt[0] === PAD_MAGIC) {
    const len = new DataView(pt.buffer, pt.byteOffset, pt.byteLength).getUint32(1, true);
    body = pt.subarray(HEADER_LEN, HEADER_LEN + len);
  }
  try {
    return JSON.parse(new TextDecoder().decode(body)) as PlainMessage;
  } catch {
    throw new DecryptError();
  }
}
