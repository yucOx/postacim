import { argon2id } from 'hash-wasm';
import { fromHex, randomBytes, toHex } from './bytes';

export const ARGON2_PARAMS = {
  parallelism: 1,
  iterations: 3,
  memorySize: 65536, // 64 MiB — desktop-first
  hashLength: 64,
} as const;

export interface DerivedKeys {
  /** first 32 bytes — sent to server as the auth material */
  authMaterial: Uint8Array;
  /** last 32 bytes — key-encryption key, never leaves the browser */
  kek: Uint8Array;
}

export const newKdfSaltHex = (): string => toHex(randomBytes(16));

export async function deriveKeys(password: string, saltHex: string): Promise<DerivedKeys> {
  const out = await argon2id({
    password,
    salt: fromHex(saltHex),
    ...ARGON2_PARAMS,
    outputType: 'binary',
  });
  return { authMaterial: out.slice(0, 32), kek: out.slice(32, 64) };
}
