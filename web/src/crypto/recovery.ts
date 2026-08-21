// Recovery-phrase key derivation: identical KDF chain to the password path,
// just fed with the normalized 12-word phrase. First 32B = server verifier
// proof, last 32B = KEK that wraps the identity inside the recovery blob.
import { b64 } from './bytes';
import { deriveKeys } from './argon2';

export async function deriveRecoveryKeys(
  words: string[],
  saltHex: string,
): Promise<{ authMaterial: Uint8Array; kek: Uint8Array }> {
  const phrase = words
    .map((w) => w.trim().toLowerCase().normalize('NFKD'))
    .join(' ');
  return deriveKeys(phrase, saltHex);
}

export const recoveryAuthB64 = (m: Uint8Array): string => b64(m);
