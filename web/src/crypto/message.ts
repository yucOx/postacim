import { sodium } from './sodium';
import { b64, unb64 } from './bytes';

export interface PlainMessage {
  t: 'msg';
  body: string;
  sent: number;
}

// AAD binds ciphertext to channel + key epoch: the server cannot relocate a
// captured ciphertext into another channel or replay it under another epoch.
const aad = (channelId: string, version: number): string => `ch:${channelId}:v${version}`;

export function encryptText(
  channelId: string,
  version: number,
  key: Uint8Array,
  body: string,
): { nonce: string; ciphertext: string } {
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const plain = new TextEncoder().encode(
    JSON.stringify({ t: 'msg', body, sent: Date.now() } satisfies PlainMessage),
  );
  const ct = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plain,
    aad(channelId, version),
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
): PlainMessage {
  let pt: Uint8Array;
  try {
    pt = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      unb64(ciphertextB64),
      aad(channelId, version),
      unb64(nonceB64),
      key,
    );
  } catch {
    throw new DecryptError();
  }
  try {
    return JSON.parse(new TextDecoder().decode(pt)) as PlainMessage;
  } catch {
    throw new DecryptError();
  }
}
