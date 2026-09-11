import { describe, expect, it } from 'vitest';
import { safetyNumber } from './safety';

const randB64 = (n = 32): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};

describe('safetyNumber', () => {
  it('is symmetric', async () => {
    const a = randB64();
    const b = randB64();
    expect(await safetyNumber(a, b)).toBe(await safetyNumber(b, a));
  });

  it('is 30 digits grouped in fives', async () => {
    const s = await safetyNumber(randB64(), randB64());
    expect(s).toMatch(/^[0-9 ]+$/);
    expect(s).toHaveLength(35); // 30 digits + 5 separators
    expect(s.split(' ')).toHaveLength(6);
    expect(s.split(' ').every((g) => g.length === 5)).toBe(true);
  });

  it('is deterministic', async () => {
    const a = randB64();
    const b = randB64();
    expect(await safetyNumber(a, b)).toBe(await safetyNumber(a, b));
  });

  it('differs for different key pairs', async () => {
    const [a, b, c, d] = [randB64(), randB64(), randB64(), randB64()];
    expect(await safetyNumber(a, b)).not.toBe(await safetyNumber(c, d));
  });
});
