// Human-comparable identity fingerprints, Signal-style. Both peers hash the
// SAME canonical input — the two X25519 public keys concatenated in sorted
// byte order — so each side independently computes an identical number to
// compare out-of-band (in person, by voice). A mismatch means the server
// swapped someone's identity key.
import { concat, toHex } from './bytes';

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', data as unknown as ArrayBuffer);
  return new Uint8Array(digest);
}

/** lexicographic byte comparison — sorts keys so both sides hash the same order */
function compareBytes(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return a.length - b.length;
}

/** group a digit string in fixed-size chunks: '123456…' → '12345 67890 …' */
const groupDigits = (digits: string): string => digits.replace(/(\d{5})(?=\d)/g, '$1 ');

/**
 * Full safety number: SHA-256 over both public keys sorted lexicographically,
 * the whole 256-bit digest folded mod 10^40 → 40 digits in 8 groups of 5.
 * 40 digits carry ~133 bits of displayed entropy — Signal uses 60 digits
 * (~199 bits), but that exceeds what a 128-bit X25519 key can back; 8 groups
 * still compare easily by eye or when read aloud.
 */
export async function fingerprintPair(myPublicKey: Uint8Array, peerPublicKey: Uint8Array): Promise<string> {
  const [a, b] =
    compareBytes(myPublicKey, peerPublicKey) <= 0
      ? [myPublicKey, peerPublicKey]
      : [peerPublicKey, myPublicKey];
  const digest = await sha256(concat(a, b));
  let n = 0n;
  for (const byte of digest) n = (n << 8n) | BigInt(byte);
  return groupDigits((n % 10n ** 40n).toString().padStart(40, '0'));
}

/** quick eyeball check: first 16 hex chars of the peer key, grouped 4×4 */
export function shortFingerprint(publicKey: Uint8Array): string {
  const hex = toHex(publicKey).slice(0, 16);
  return hex.replace(/(.{4})(?=.)/g, '$1 ');
}
