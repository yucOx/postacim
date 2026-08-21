// BIP-39 mnemonic helpers: 128-bit entropy → 12 words with a 4-bit checksum.
// The phrase is only a memorable high-entropy secret for this app — key
// derivation goes through the same Argon2id path as passwords (recovery.ts).
import { BIP39_WORDS } from './bip39-words';

const INDEX = new Map(BIP39_WORDS.map((w, i) => [w, i]));

/** bits of a byte array as a '1010…' string */
function toBits(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(2).padStart(8, '0');
  return out;
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', data as unknown as ArrayBuffer);
  return new Uint8Array(digest);
}

/** generate a fresh 12-word phrase (128 bits of entropy + checksum) */
export async function generateMnemonic(): Promise<string[]> {
  const entropy = crypto.getRandomValues(new Uint8Array(16));
  const checksumBits = toBits(await sha256(entropy)).slice(0, 4); // ENT/32
  const bits = toBits(entropy) + checksumBits;
  const words: string[] = [];
  for (let i = 0; i < 12; i++) {
    words.push(BIP39_WORDS[parseInt(bits.slice(i * 11, (i + 1) * 11), 2)]!);
  }
  return words;
}

/** validate structure + checksum of a 12-word phrase (NFKD-normalized) */
export async function validateMnemonic(input: string[]): Promise<boolean> {
  if (input.length !== 12) return false;
  const indices: number[] = [];
  for (const w of input) {
    const idx = INDEX.get(w.trim().toLowerCase().normalize('NFKD'));
    if (idx === undefined) return false;
    indices.push(idx);
  }
  let bits = indices.map((i) => i.toString(2).padStart(11, '0')).join('');
  const entropyBits = bits.slice(0, 128);
  const checksum = bits.slice(128);
  const entropy = new Uint8Array(16);
  for (let i = 0; i < 16; i++) entropy[i] = parseInt(entropyBits.slice(i * 8, i * 8 + 8), 2);
  return toBits(await sha256(entropy)).slice(0, 4) === checksum;
}

/** k random distinct positions for the "prove you wrote it down" quiz */
export function quizPositions(count = 3): number[] {
  const pool = Array.from({ length: 12 }, (_, i) => i);
  const picked: number[] = [];
  while (picked.length < count) {
    picked.push(...pool.splice(Math.floor(Math.random() * pool.length), 1));
  }
  return picked;
}
