import { sodium } from './sodium';
import { b64, unb64 } from './bytes';

export interface PlainMessage {
  t: 'msg';
  body: string;
  sent: number;
}

// AAD binds ciphertext to scope + channel + key epoch: the server cannot
// relocate a captured ciphertext into another context or replay it under
// another epoch. Scope: 'ch' = community channel, 'dm' = direct message.
export type MsgScope = 'ch' | 'dm';
const aad = (scope: MsgScope, channelId: string, version: number): string =>
  `${scope}:${channelId}:v${version}`;

export function encryptText(
  channelId: string,
  version: number,
  key: Uint8Array,
  body: string,
  scope: MsgScope = 'ch',
): { nonce: string; ciphertext: string } {
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const plain = new TextEncoder().encode(
    JSON.stringify({ t: 'msg', body, sent: Date.now() } satisfies PlainMessage),
  );
  const ct = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plain,
    aad(scope, channelId, version),
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
): PlainMessage {
  let pt: Uint8Array;
  try {
    pt = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      unb64(ciphertextB64),
      aad(scope, channelId, version),
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
