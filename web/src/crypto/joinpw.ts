import { sodium } from './sodium';
import { b64, concat, unb64 } from './bytes';

const JOINPW_AAD = 'postacim/v1/joinpw';

/** Channel key encrypted under the Argon2id-derived join key (JW). */
export function sealJoinKey(key: Uint8Array, jw: Uint8Array): string {
  const nonce = sodium.randombytes_buf(24);
  const ct = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(key, JOINPW_AAD, null, nonce, jw);
  return b64(concat(nonce, ct));
}

export function openJoinKey(blobB64: string, jw: Uint8Array): Uint8Array {
  const raw = unb64(blobB64);
  return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, raw.slice(24), JOINPW_AAD, raw.slice(0, 24), jw);
}
