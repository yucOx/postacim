// Signal-style safety number: SHA-256 over the SORTED base64 public keys
// (order-invariant), first 16 bytes as a big integer, mod 10^30, zero-padded
// and grouped in fives. Both sides derive the same 30 digits out-of-band.

const group = (digits: string): string => digits.replace(/(\d{5})(?=\d)/g, '$1 ');

export async function safetyNumber(pubA: string, pubB: string): Promise<string> {
  const [a, b] = [pubA, pubB].sort();
  const data = new TextEncoder().encode(`${a}|${b}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  let n = 0n;
  for (let i = 0; i < 16; i++) n = (n << 8n) | BigInt(digest[i]!);
  return group((n % 10n ** 30n).toString().padStart(30, '0'));
}
