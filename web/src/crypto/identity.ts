import { sodium } from './sodium';
import { b64, concat, randomBytes, unb64 } from './bytes';

const IDENTITY_AAD = 'postacim/v1/identity';

// blob payload sürümleri:
//   v1 = X25519 private (32B)                       — yalnız Diffie-Hellman
//   v2 = 0x02 ‖ X25519 priv (32) ‖ Ed25519 priv (64) — gönderen atfı
//   v3 = 0x03 ‖ X25519 priv (32) ‖ Ed25519 priv (64) ‖ device_id (16) — çoklu cihaz
// Eski blob'lar aynen açılır — sürüm/düzen ayrımı boyuttan.
const BLOB_V2 = 0x02;
const BLOB_V3 = 0x03;
const KEY_LEN = 32;
const DEVICE_ID_LEN = 16;

export interface Identity {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export interface SignIdentity {
  signPublicKey: Uint8Array;
  signPrivateKey: Uint8Array;
}

/** açılmış kimlik blob'u — imza anahtarı yalnız v2+ blob'larda var,
 *  device_id yalnız v3'te (v1/v2 blob'lu hesaplar primary sayılır) */
export interface OpenedIdentity {
  privateKey: Uint8Array;
  signPrivateKey: Uint8Array | null;
  /** v3 blob'larda 16B device UUID; eski blob'larda null (primary alias) */
  deviceId: Uint8Array | null;
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

/** Faz 7: 16B device UUID — her cihaz bağımsız keypair taşır. */
export function generateDeviceId(): Uint8Array {
  return randomBytes(DEVICE_ID_LEN);
}

/**
 * nonce(24) || XChaCha20-Poly1305(payload) under KEK — stored server-side.
 * signPrivateKey verilirse payload v2+; deviceId de verilirse v3.
 * deviceId yoksa v2 (geriye uyumluluk); signPrivateKey yoksa v1.
 */
export function sealIdentityBlob(
  privateKey: Uint8Array,
  kek: Uint8Array,
  signPrivateKey?: Uint8Array,
  deviceId?: Uint8Array,
): string {
  let payload: Uint8Array;
  if (signPrivateKey && deviceId) {
    payload = concat(new Uint8Array([BLOB_V3]), privateKey, signPrivateKey, deviceId);
  } else if (signPrivateKey) {
    payload = concat(new Uint8Array([BLOB_V2]), privateKey, signPrivateKey);
  } else {
    payload = privateKey;
  }
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
  // v3: 0x03 ‖ X25519 priv (32) ‖ Ed25519 priv (64) ‖ device_id (16)
  const v3Len = 1 + KEY_LEN + sodium.crypto_sign_SECRETKEYBYTES + DEVICE_ID_LEN;
  if (pt.length === v3Len && pt[0] === BLOB_V3) {
    return {
      privateKey: pt.slice(1, KEY_LEN + 1),
      signPrivateKey: pt.slice(KEY_LEN + 1, KEY_LEN + 1 + sodium.crypto_sign_SECRETKEYBYTES),
      deviceId: pt.slice(KEY_LEN + 1 + sodium.crypto_sign_SECRETKEYBYTES),
    };
  }
  // v2: 0x02 ‖ X25519 priv (32) ‖ Ed25519 priv (64)
  const v2Len = 1 + KEY_LEN + sodium.crypto_sign_SECRETKEYBYTES;
  if (pt.length === v2Len && pt[0] === BLOB_V2) {
    return { privateKey: pt.slice(1, KEY_LEN + 1), signPrivateKey: pt.slice(KEY_LEN + 1), deviceId: null };
  }
  return { privateKey: pt, signPrivateKey: null, deviceId: null };
}

/** Channel key sealed to a member's X25519 public key — server cannot open it. */
export const wrapKeyFor = (key: Uint8Array, peerPublicKeyB64: string): string =>
  b64(sodium.crypto_box_seal(key, unb64(peerPublicKeyB64)));

export const unwrapMyKey = (
  sealedKeyB64: string,
  myPublicKey: Uint8Array,
  myPrivateKey: Uint8Array,
): Uint8Array => sodium.crypto_box_seal_open(unb64(sealedKeyB64), myPublicKey, myPrivateKey);
