import { sodium } from './sodium';
import { b64, concat, unb64 } from './bytes';

const IDENTITY_AAD = 'postacim/v1/identity';

export interface Identity {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export function generateIdentity(): Identity {
  const kp = sodium.crypto_box_keypair();
  return { publicKey: kp.publicKey, privateKey: kp.privateKey };
}

/** nonce(24) || XChaCha20-Poly1305(privateKey) under KEK — stored server-side */
export function sealIdentityBlob(privateKey: Uint8Array, kek: Uint8Array): string {
  const nonce = sodium.randombytes_buf(24);
  const ct = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    privateKey,
    IDENTITY_AAD,
    null,
    nonce,
    kek,
  );
  return b64(concat(nonce, ct));
}

/** Throws if KEK is wrong (i.e. wrong password). */
export function openIdentityBlob(blobB64: string, kek: Uint8Array): Uint8Array {
  const raw = unb64(blobB64);
  return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    raw.slice(24),
    IDENTITY_AAD,
    raw.slice(0, 24),
    kek,
  );
}

/** Channel key sealed to a member's X25519 public key — server cannot open it. */
export const wrapKeyFor = (key: Uint8Array, peerPublicKeyB64: string): string =>
  b64(sodium.crypto_box_seal(key, unb64(peerPublicKeyB64)));

export const unwrapMyKey = (
  sealedKeyB64: string,
  myPublicKey: Uint8Array,
  myPrivateKey: Uint8Array,
): Uint8Array => sodium.crypto_box_seal_open(unb64(sealedKeyB64), myPublicKey, myPrivateKey);
