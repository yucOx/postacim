import { sodium } from './sodium';
import { b64, concat, unb64 } from './bytes';

const IDENTITY_AAD = 'postacim/v1/identity';

// blob payload sürümleri: v1 = X25519 private (32B); v2 = 0x02 ‖ X25519 private
// ‖ Ed25519 private (gönderen atfı). Eski blob'lar aynen açılır — boyut hem
// sürümü hem düzeni ayırt eder.
const BLOB_V2 = 0x02;
const KEY_LEN = 32;

export interface Identity {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export interface SignIdentity {
  signPublicKey: Uint8Array;
  signPrivateKey: Uint8Array;
}

/** açılmış kimlik blob'u — imza anahtarı yalnız v2 blob'larda var */
export interface OpenedIdentity {
  privateKey: Uint8Array;
  signPrivateKey: Uint8Array | null;
}

export function generateIdentity(): Identity {
  const kp = sodium.crypto_box_keypair();
  return { publicKey: kp.publicKey, privateKey: kp.privateKey };
}

export function generateSignIdentity(): SignIdentity {
  const kp = sodium.crypto_sign_keypair();
  return { signPublicKey: kp.publicKey, signPrivateKey: kp.privateKey };
}

/** Ed25519 private = seed ‖ public — public yarısı private'tan türetilebilir
 *  (cihaz blob'u yalnız private sakladığı için fingerprint buna muhtaç) */
export const signPublicKeyFromPrivate = (signPrivateKey: Uint8Array): Uint8Array =>
  sodium.crypto_sign_seed_keypair(signPrivateKey.slice(0, 32)).publicKey;

/**
 * nonce(24) || XChaCha20-Poly1305(payload) under KEK — stored server-side.
 * signPrivateKey verilirse payload v2'dir (her iki private key); verilmezse
 * v1 (yalnız X25519) — eski istemcilerin ürettiği blob'la aynı.
 */
export function sealIdentityBlob(privateKey: Uint8Array, kek: Uint8Array, signPrivateKey?: Uint8Array): string {
  const payload = signPrivateKey
    ? concat(new Uint8Array([BLOB_V2]), privateKey, signPrivateKey)
    : privateKey;
  const nonce = sodium.randombytes_buf(24);
  const ct = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    payload,
    IDENTITY_AAD,
    null,
    nonce,
    kek,
  );
  return b64(concat(nonce, ct));
}

/** Throws if KEK is wrong (i.e. wrong password). */
export function openIdentityBlob(blobB64: string, kek: Uint8Array): OpenedIdentity {
  const raw = unb64(blobB64);
  const pt = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    raw.slice(24),
    IDENTITY_AAD,
    raw.slice(0, 24),
    kek,
  );
  // v2: 0x02 ‖ X25519 private (32) ‖ Ed25519 private (64)
  const v2Len = 1 + KEY_LEN + sodium.crypto_sign_SECRETKEYBYTES;
  if (pt.length === v2Len && pt[0] === BLOB_V2) {
    return { privateKey: pt.slice(1, KEY_LEN + 1), signPrivateKey: pt.slice(KEY_LEN + 1) };
  }
  return { privateKey: pt, signPrivateKey: null };
}

/** Channel key sealed to a member's X25519 public key — server cannot open it. */
export const wrapKeyFor = (key: Uint8Array, peerPublicKeyB64: string): string =>
  b64(sodium.crypto_box_seal(key, unb64(peerPublicKeyB64)));

export const unwrapMyKey = (
  sealedKeyB64: string,
  myPublicKey: Uint8Array,
  myPrivateKey: Uint8Array,
): Uint8Array => sodium.crypto_box_seal_open(unb64(sealedKeyB64), myPublicKey, myPrivateKey);
